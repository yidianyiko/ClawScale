/**
 * Discord Adapter
 *
 * Manages one discord.js Client per connected Discord channel.
 * On startup, loads all connected Discord channels from the DB and starts bots.
 * Exposes start/stop helpers so the channels route can hot-plug bots when an
 * owner connects or disconnects a channel from the dashboard.
 *
 * Flow per message:
 *   Discord message → normalize → POST /gateway/:channelId (internal) → reply
 */

import { Client, Events, GatewayIntentBits, Message } from 'discord.js';
import { db } from '../db/index.js';

// Map of clawscale channelId → discord.js Client
const clients = new Map<string, Client>();

// Internal gateway base URL — same process, just HTTP to itself
const GATEWAY_URL = `http://127.0.0.1:${process.env['PORT'] ?? 3001}`;

// ── Start a bot for a single channel ─────────────────────────────────────────

export async function startDiscordBot(channelId: string, botToken: string): Promise<void> {
  if (clients.has(channelId)) return; // already running

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore messages from bots (including itself)
    if (message.author.bot) return;

    try {
      const res = await fetch(`${GATEWAY_URL}/gateway/${channelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalId: message.author.id,
          displayName: message.author.username,
          text: message.content,
          meta: {
            guildId: message.guildId ?? null,
            channelId: message.channelId,
            messageId: message.id,
          },
        }),
      });

      const data = (await res.json()) as { ok: boolean; data?: { reply: string }; error?: string };

      if (data.ok && data.data?.reply) {
        await message.reply(data.data.reply);
      }
    } catch (err) {
      console.error(`[discord:${channelId}] Error routing message:`, err);
    }
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord:${channelId}] Logged in as ${c.user.tag}`);
  });

  await client.login(botToken);
  clients.set(channelId, client);
}

// ── Stop a bot for a single channel ──────────────────────────────────────────

export async function stopDiscordBot(channelId: string): Promise<void> {
  const client = clients.get(channelId);
  if (!client) return;
  await client.destroy();
  clients.delete(channelId);
  console.log(`[discord:${channelId}] Bot stopped`);
}

// ── Boot all connected Discord channels on API startup ────────────────────────

export async function initDiscordAdapters(): Promise<void> {
  const channels = await db.channel.findMany({
    where: { type: 'discord', status: 'connected' },
    select: { id: true, config: true },
  });

  for (const channel of channels) {
    const config = channel.config as Record<string, string> | null;
    const botToken = config?.['botToken'];
    if (!botToken) continue;

    try {
      await startDiscordBot(channel.id, botToken);
    } catch (err) {
      console.error(`[discord:${channel.id}] Failed to start bot:`, err);
    }
  }

  console.log(`[discord] Initialized ${channels.length} Discord bot(s)`);
}
