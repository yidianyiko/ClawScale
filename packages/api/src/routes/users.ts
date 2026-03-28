import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, tenants } from '../db/schema.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { hashPassword } from '../lib/password.js';
import { audit } from '../lib/audit.js';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  /** Temporary password — user should change on first login */
  temporaryPassword: z.string().min(8),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  isActive: z.boolean().optional(),
});

const userSelect = {
  id: users.id,
  tenantId: users.tenantId,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  createdAt: users.createdAt,
  lastActiveAt: users.lastActiveAt,
};

export const usersRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/users ───────────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db
      .select(userSelect)
      .from(users)
      .where(eq(users.tenantId, tenantId));

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/users — invite a new user ─────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', inviteSchema), async (c) => {
    const { tenantId, userId: actorId } = c.get('auth');
    const body = c.req.valid('json');

    // Check plan limit
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const settings = tenant?.settings as { maxUsers?: number } | undefined;
    const maxUsers = settings?.maxUsers ?? 5;

    const currentCount = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));

    if (currentCount.length >= maxUsers) {
      return c.json({ ok: false, error: `Plan limit reached (${maxUsers} users max)` }, 422);
    }

    // Check duplicate email within tenant
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, body.email.toLowerCase())))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ ok: false, error: 'A user with this email already exists' }, 409);
    }

    const id = generateId('usr');
    const passwordHash = await hashPassword(body.temporaryPassword);

    await db.insert(users).values({
      id,
      tenantId,
      email: body.email.toLowerCase(),
      name: body.name,
      passwordHash,
      role: body.role,
    });

    await audit({ tenantId, userId: actorId, action: 'invite_user', resource: 'user', resourceId: id });

    const [created] = await db.select(userSelect).from(users).where(eq(users.id, id)).limit(1);
    return c.json({ ok: true, data: created }, 201);
  })

  // ── GET /api/users/:id ───────────────────────────────────────────────────────
  .get('/:id', async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const [user] = await db
      .select(userSelect)
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .limit(1);

    if (!user) return c.json({ ok: false, error: 'User not found' }, 404);
    return c.json({ ok: true, data: user });
  })

  // ── PATCH /api/users/:id ─────────────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId: actorId } = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .limit(1);

    if (!existing) return c.json({ ok: false, error: 'User not found' }, 404);

    await db
      .update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, id));

    await audit({ tenantId, userId: actorId, action: 'update_user', resource: 'user', resourceId: id, meta: body });

    const [updated] = await db.select(userSelect).from(users).where(eq(users.id, id)).limit(1);
    return c.json({ ok: true, data: updated });
  })

  // ── DELETE /api/users/:id — deactivate (not hard delete) ────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId: actorId } = c.get('auth');
    const id = c.req.param('id');

    if (id === actorId) {
      return c.json({ ok: false, error: 'You cannot deactivate your own account' }, 422);
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .limit(1);

    if (!existing) return c.json({ ok: false, error: 'User not found' }, 404);

    await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, id));

    await audit({ tenantId, userId: actorId, action: 'deactivate_user', resource: 'user', resourceId: id });

    return c.json({ ok: true, data: null });
  });
