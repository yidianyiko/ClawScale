import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';

const BACKEND_TYPES = ['openai', 'anthropic', 'openrouter', 'pulse', 'openclaw', 'custom'] as const;

const configSchema = z.object({
  apiKey:      z.string().optional(),
  model:       z.string().optional(),
  baseUrl:     z.string().url().optional(),
  pulseApiUrl: z.string().url().optional(),
  openClawUrl: z.string().url().optional(),
}).default({});

const createSchema = z.object({
  name:     z.string().min(1).max(80),
  type:     z.enum(BACKEND_TYPES),
  config:   configSchema,
  isActive: z.boolean().default(true),
});

const updateSchema = z.object({
  name:     z.string().min(1).max(80).optional(),
  type:     z.enum(BACKEND_TYPES).optional(),
  config:   configSchema.optional(),
  isActive: z.boolean().optional(),
});

export const aiBackendsRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/ai-backends ─────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db.aiBackend.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, tenantId: true, name: true, type: true,
        isActive: true, createdAt: true, updatedAt: true,
        // config omitted in list view (may contain API keys)
      },
    });

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/ai-backends ────────────────────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const body = c.req.valid('json');

    const id = generateId('aib');
    await db.aiBackend.create({
      data: {
        id, tenantId,
        name: body.name,
        type: body.type,
        config: body.config,
        isActive: body.isActive,
      },
    });

    await audit({ tenantId, memberId: userId, action: 'create_ai_backend', resource: 'ai_backend', resourceId: id });

    const created = await db.aiBackend.findUnique({ where: { id } });
    return c.json({ ok: true, data: created }, 201);
  })

  // ── GET /api/ai-backends/:id ─────────────────────────────────────────────────
  .get('/:id', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const backend = await db.aiBackend.findFirst({ where: { id, tenantId } });
    if (!backend) return c.json({ ok: false, error: 'AI backend not found' }, 404);

    return c.json({ ok: true, data: backend });
  })

  // ── PATCH /api/ai-backends/:id ───────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const existing = await db.aiBackend.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) return c.json({ ok: false, error: 'AI backend not found' }, 404);

    await db.aiBackend.update({ where: { id }, data: body });
    await audit({ tenantId, memberId: userId, action: 'update_ai_backend', resource: 'ai_backend', resourceId: id });

    const updated = await db.aiBackend.findUnique({ where: { id } });
    return c.json({ ok: true, data: updated });
  })

  // ── DELETE /api/ai-backends/:id ──────────────────────────────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const existing = await db.aiBackend.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) return c.json({ ok: false, error: 'AI backend not found' }, 404);

    // Clear selectedBackendId from any end-users pointing to this backend
    await db.endUser.updateMany({ where: { tenantId, selectedBackendId: id }, data: { selectedBackendId: null } });

    await db.aiBackend.delete({ where: { id } });
    await audit({ tenantId, memberId: userId, action: 'delete_ai_backend', resource: 'ai_backend', resourceId: id });

    return c.json({ ok: true, data: null });
  });
