/**
 * WeChat Work (WeCom) Adapter
 *
 * Manages one @wecom/aibot-node-sdk WSClient per connected WeCom channel.
 * On startup, loads all connected WeCom channels from the DB and starts bots.
 *
 * Flow per message:
 *   WeCom text message → normalize → POST /gateway/:channelId (internal) → reply
 */

import AiBot from '@wecom/aibot-node-sdk';
import { db } from '../db/index.js';

// Map of clawscale channelId → WSClient
const clients = new Map<string, InstanceType<typeof AiBot.WSClient>>();

const GATEWAY_URL = `http://127.0.0.1:${process.env['PORT'] ?? 3001}`;

// ── Start a bot for a single channel ─────────────────────────────────────────

export async function startWeChatBot(channelId: string, botId: string, secret: string): Promise<void> {
  if (clients.has(channelId)) return;

  const client = new AiBot.WSClient({ botId, secret });

  client.on('message.text', async (frame: { text?: { content?: string }; sender?: { user_id?: string; name?: string } }) => {
    const text = frame.text?.content?.trim();
    if (!text) return;

    try {
      const res = await fetch(`${GATEWAY_URL}/gateway/${channelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalId: frame.sender?.user_id ?? 'unknown',
          displayName: frame.sender?.name,
          text,
          meta: { platform: 'wechat_work' },
        }),
      });

      const data = (await res.json()) as { ok: boolean; data?: { reply: string }; error?: string };

      if (data.ok && data.data?.reply) {
        await client.reply(data.data.reply);
      }
    } catch (err) {
      console.error(`[wechat:${channelId}] Error routing message:`, err);
    }
  });

  client.connect();
  clients.set(channelId, client);
  console.log(`[wechat:${channelId}] Bot connected (botId: ${botId})`);
}

// ── Stop a bot for a single channel ──────────────────────────────────────────

export async function stopWeChatBot(channelId: string): Promise<void> {
  const client = clients.get(channelId);
  if (!client) return;
  // WSClient does not expose a close method in the public API; drop the reference
  // so it gets GC'd and reconnects won't restart under the old channelId.
  clients.delete(channelId);
  console.log(`[wechat:${channelId}] Bot stopped`);
}

// ── Boot all connected WeCom channels on API startup ─────────────────────────

export async function initWeChatAdapters(): Promise<void> {
  const channels = await db.channel.findMany({
    where: { type: 'wechat_work', status: 'connected' },
    select: { id: true, config: true },
  });

  for (const channel of channels) {
    const config = channel.config as Record<string, string> | null;
    const botId = config?.['botId'];
    const secret = config?.['secret'];
    if (!botId || !secret) continue;

    try {
      await startWeChatBot(channel.id, botId, secret);
    } catch (err) {
      console.error(`[wechat:${channel.id}] Failed to start bot:`, err);
    }
  }

  console.log(`[wechat] Initialized ${channels.length} WeCom bot(s)`);
}
