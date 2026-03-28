import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tenants, auditLogs, users } from '../db/schema.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const updateSettingsSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  settings: z
    .object({
      personaName: z.string().min(1).max(80).optional(),
      personaPrompt: z.string().max(4000).optional(),
      features: z
        .object({
          sharedMemory: z.boolean().optional(),
          privateThreads: z.boolean().optional(),
          knowledgeBase: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const tenantRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/tenant ──────────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) return c.json({ ok: false, error: 'Tenant not found' }, 404);
    return c.json({ ok: true, data: tenant });
  })

  // ── PATCH /api/tenant ────────────────────────────────────────────────────────
  .patch('/', requireAdmin, zValidator('json', updateSettingsSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const body = c.req.valid('json');

    const [current] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!current) return c.json({ ok: false, error: 'Tenant not found' }, 404);

    const updatedSettings =
      body.settings != null
        ? { ...(current.settings as object), ...body.settings }
        : current.settings;

    await db
      .update(tenants)
      .set({
        ...(body.name != null ? { name: body.name } : {}),
        settings: updatedSettings,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    await audit({ tenantId, userId, action: 'update_tenant_settings', resource: 'tenant', resourceId: tenantId });

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return c.json({ ok: true, data: updated });
  })

  // ── GET /api/tenant/audit ────────────────────────────────────────────────────
  .get('/audit', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const rows = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userName: users.name,
        action: auditLogs.action,
        resource: auditLogs.resource,
        resourceId: auditLogs.resourceId,
        meta: auditLogs.meta,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(eq(auditLogs.tenantId, tenantId))
      .orderBy(auditLogs.createdAt)
      .limit(limit)
      .offset(offset);

    return c.json({ ok: true, data: rows });
  })

  // ── GET /api/tenant/stats ────────────────────────────────────────────────────
  .get('/stats', async (c) => {
    const { tenantId } = c.get('auth');

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

    const userRows = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.tenantId, tenantId));

    const totalUsers = userRows.length;
    const activeUsers = userRows.filter((u) => u.isActive).length;

    return c.json({
      ok: true,
      data: {
        plan: tenant?.plan ?? 'starter',
        totalUsers,
        activeUsers,
        settings: tenant?.settings,
      },
    });
  });
