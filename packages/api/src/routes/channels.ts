import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { channels, tenants } from '../db/schema.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';
import {
  startTenantGateway,
  stopTenantGateway,
  getGatewayStatus,
} from '../lib/openclaw-bridge.js';

const CHANNEL_TYPES = [
  'whatsapp', 'telegram', 'slack', 'discord', 'instagram',
  'facebook', 'line', 'signal', 'teams', 'matrix', 'web',
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

export const channelsRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/channels ────────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db
      .select({
        id: channels.id,
        tenantId: channels.tenantId,
        type: channels.type,
        name: channels.name,
        status: channels.status,
        gatewayPort: channels.gatewayPort,
        createdAt: channels.createdAt,
        updatedAt: channels.updatedAt,
        // Config intentionally omitted from list (contains secrets)
      })
      .from(channels)
      .where(eq(channels.tenantId, tenantId));

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/channels ───────────────────────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const body = c.req.valid('json');

    // Check plan channel limit
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const settings = tenant?.settings as { maxChannels?: number } | undefined;
    const maxChannels = settings?.maxChannels ?? 3;

    const existing = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.tenantId, tenantId));

    if (existing.length >= maxChannels) {
      return c.json({ ok: false, error: `Plan limit reached (${maxChannels} channels max)` }, 422);
    }

    const id = generateId('ch');
    await db.insert(channels).values({
      id,
      tenantId,
      type: body.type,
      name: body.name,
      config: body.config,
      status: 'disconnected',
    });

    await audit({ tenantId, userId, action: 'create_channel', resource: 'channel', resourceId: id });

    const [created] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
    return c.json({ ok: true, data: { ...created, config: undefined } }, 201);
  })

  // ── GET /api/channels/:id ────────────────────────────────────────────────────
  .get('/:id', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
      .limit(1);

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    return c.json({ ok: true, data: channel });
  })

  // ── PATCH /api/channels/:id ──────────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
      .limit(1);

    if (!existing) return c.json({ ok: false, error: 'Channel not found' }, 404);

    await db.update(channels).set({ ...body, updatedAt: new Date() }).where(eq(channels.id, id));
    await audit({ tenantId, userId, action: 'update_channel', resource: 'channel', resourceId: id });

    const [updated] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
    return c.json({ ok: true, data: { ...updated, config: undefined } });
  })

  // ── DELETE /api/channels/:id ─────────────────────────────────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
      .limit(1);

    if (!existing) return c.json({ ok: false, error: 'Channel not found' }, 404);

    // Stop the gateway process if running
    if (existing.status === 'connected') {
      stopTenantGateway(`${tenantId}:${id}`);
    }

    await db.delete(channels).where(eq(channels.id, id));
    await audit({ tenantId, userId, action: 'delete_channel', resource: 'channel', resourceId: id });

    return c.json({ ok: true, data: null });
  })

  // ── POST /api/channels/:id/connect ──────────────────────────────────────────
  .post('/:id/connect', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
      .limit(1);

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    if (channel.status === 'connected') {
      return c.json({ ok: true, data: { message: 'Already connected' } });
    }

    // Mark as pending while we spin up the OpenClaw process
    await db.update(channels).set({ status: 'pending', updatedAt: new Date() }).where(eq(channels.id, id));

    try {
      const gatewayKey = `${tenantId}:${id}`;
      const port = await startTenantGateway(gatewayKey);

      await db
        .update(channels)
        .set({ status: 'connected', gatewayPort: port, updatedAt: new Date() })
        .where(eq(channels.id, id));

      await audit({ tenantId, userId, action: 'connect_channel', resource: 'channel', resourceId: id });

      return c.json({ ok: true, data: { status: 'connected', gatewayPort: port } });
    } catch (err) {
      await db.update(channels).set({ status: 'error', updatedAt: new Date() }).where(eq(channels.id, id));
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ ok: false, error: `Failed to start gateway: ${message}` }, 500);
    }
  })

  // ── POST /api/channels/:id/disconnect ───────────────────────────────────────
  .post('/:id/disconnect', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
      .limit(1);

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);

    stopTenantGateway(`${tenantId}:${id}`);

    await db
      .update(channels)
      .set({ status: 'disconnected', gatewayPort: null, gatewayPid: null, updatedAt: new Date() })
      .where(eq(channels.id, id));

    await audit({ tenantId, userId, action: 'disconnect_channel', resource: 'channel', resourceId: id });

    return c.json({ ok: true, data: { status: 'disconnected' } });
  })

  // ── GET /api/channels/:id/status ────────────────────────────────────────────
  .get('/:id/status', async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const [channel] = await db
      .select({ id: channels.id, status: channels.status, gatewayPort: channels.gatewayPort })
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.tenantId, tenantId)))
      .limit(1);

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);

    const processStatus = getGatewayStatus(`${tenantId}:${id}`);
    return c.json({ ok: true, data: { ...channel, processStatus } });
  });
