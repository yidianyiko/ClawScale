import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';
import { startDiscordBot, stopDiscordBot } from '../adapters/discord.js';
import { startWeChatBot, stopWeChatBot } from '../adapters/wechat.js';

const CHANNEL_TYPES = [
  'whatsapp', 'telegram', 'slack', 'discord', 'instagram',
  'facebook', 'line', 'signal', 'teams', 'matrix', 'web', 'wechat_work',
] as const;

const createSchema = z.object({
  type: z.enum(CHANNEL_TYPES),
  name: z.string().min(1).max(80),
  config: z.record(z.unknown()).default({}),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  config: z.record(z.unknown()).optional(),
});

const channelListSelect = {
  id: true,
  tenantId: true,
  type: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // config intentionally omitted (contains secrets)
} as const;

export const channelsRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/channels ────────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db.channel.findMany({
      where: { tenantId },
      select: channelListSelect,
    });

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/channels ───────────────────────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const body = c.req.valid('json');

    // Check plan channel limit
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const settings = tenant?.settings as { maxChannels?: number } | undefined;
    const maxChannels = settings?.maxChannels ?? 3;

    const channelCount = await db.channel.count({ where: { tenantId } });

    if (channelCount >= maxChannels) {
      return c.json({ ok: false, error: `Plan limit reached (${maxChannels} channels max)` }, 422);
    }

    const id = generateId('ch');
    await db.channel.create({
      data: {
        id,
        tenantId,
        type: body.type,
        name: body.name,
        config: body.config,
        status: 'disconnected',
      },
    });

    await audit({ tenantId, memberId: userId, action: 'create_channel', resource: 'channel', resourceId: id });

    const created = await db.channel.findUnique({ where: { id }, select: channelListSelect });
    return c.json({ ok: true, data: created }, 201);
  })

  // ── GET /api/channels/:id ────────────────────────────────────────────────────
  .get('/:id', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    // Return config only on single-channel fetch (for editing)
    const channel = await db.channel.findFirst({ where: { id, tenantId } });

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    return c.json({ ok: true, data: channel });
  })

  // ── PATCH /api/channels/:id ──────────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const existing = await db.channel.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!existing) return c.json({ ok: false, error: 'Channel not found' }, 404);

    await db.channel.update({ where: { id }, data: body });
    await audit({ tenantId, memberId: userId, action: 'update_channel', resource: 'channel', resourceId: id });

    const updated = await db.channel.findUnique({ where: { id }, select: channelListSelect });
    return c.json({ ok: true, data: updated });
  })

  // ── DELETE /api/channels/:id ─────────────────────────────────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const existing = await db.channel.findFirst({ where: { id, tenantId } });
    if (!existing) return c.json({ ok: false, error: 'Channel not found' }, 404);

    if (existing.type === 'discord') {
      stopDiscordBot(id).catch(() => {});
    } else if (existing.type === 'wechat_work') {
      stopWeChatBot(id).catch(() => {});
    }

    await db.channel.delete({ where: { id } });
    await audit({ tenantId, memberId: userId, action: 'delete_channel', resource: 'channel', resourceId: id });

    return c.json({ ok: true, data: null });
  })

  // ── POST /api/channels/:id/connect ──────────────────────────────────────────
  // Marks the channel active. The actual webhook listener is configured externally
  // (e.g. set the webhook URL on the social platform to point at /gateway/:channelId).
  .post('/:id/connect', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const channel = await db.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    if (channel.status === 'connected') {
      return c.json({ ok: true, data: { status: 'connected' } });
    }

    await db.channel.update({ where: { id }, data: { status: 'connected' } });
    await audit({ tenantId, memberId: userId, action: 'connect_channel', resource: 'channel', resourceId: id });

    // Start platform-specific adapter
    if (channel.type === 'discord') {
      const config = channel.config as Record<string, string> | null;
      const botToken = config?.['botToken'];
      if (botToken) {
        startDiscordBot(id, botToken).catch((err) =>
          console.error(`[discord:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'wechat_work') {
      const config = channel.config as Record<string, string> | null;
      const botId = config?.['botId'];
      const secret = config?.['secret'];
      if (botId && secret) {
        startWeChatBot(id, botId, secret).catch((err) =>
          console.error(`[wechat:${id}] Failed to start bot:`, err),
        );
      }
    }

    return c.json({ ok: true, data: { status: 'connected' } });
  })

  // ── POST /api/channels/:id/disconnect ───────────────────────────────────────
  .post('/:id/disconnect', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const channel = await db.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);

    await db.channel.update({ where: { id }, data: { status: 'disconnected' } });
    await audit({ tenantId, memberId: userId, action: 'disconnect_channel', resource: 'channel', resourceId: id });

    // Stop platform-specific adapter
    if (channel.type === 'discord') {
      stopDiscordBot(id).catch((err) =>
        console.error(`[discord:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'wechat_work') {
      stopWeChatBot(id).catch((err) =>
        console.error(`[wechat:${id}] Failed to stop bot:`, err),
      );
    }

    return c.json({ ok: true, data: { status: 'disconnected' } });
  });
