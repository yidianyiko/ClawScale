/**
 * Telegram Adapter (via grammy, long-polling)
 */

import { Bot } from 'grammy';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';

const bots = new Map<string, Bot>();

export async function startTelegramBot(channelId: string, token: string): Promise<void> {
  if (bots.has(channelId)) return;

  const bot = new Bot(token);

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const externalId = String(ctx.from.id);
    const displayName = ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : '');

    console.log(`[telegram:${channelId}] Incoming from ${externalId}: "${text}"`);

    try {
      const result = await routeInboundMessage({
        channelId, externalId, displayName, text,
        meta: { platform: 'telegram', chatId: ctx.chat.id },
      });
      if (result?.reply) await ctx.reply(result.reply);
    } catch (err) {
      console.error(`[telegram:${channelId}] Error routing message:`, err);
    }
  });

  bot.catch((err) => console.error(`[telegram:${channelId}] Bot error:`, err));

  bots.set(channelId, bot);
  bot.start({ drop_pending_updates: true }).catch((err) => console.error(`[telegram:${channelId}] Start error:`, err));
  console.log(`[telegram:${channelId}] Bot started`);
}

export async function stopTelegramBot(channelId: string): Promise<void> {
  const bot = bots.get(channelId);
  if (!bot) return;
  await bot.stop();
  bots.delete(channelId);
  console.log(`[telegram:${channelId}] Stopped`);
}

export async function initTelegramAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'telegram', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const token = config?.['botToken'];
    if (!token) continue;
    try { await startTelegramBot(row.id, token); } catch (err) { console.error(`[telegram:${row.id}] Init error:`, err); }
  }
  console.log(`[telegram] Initialized ${rows.length} bot(s)`);
}
