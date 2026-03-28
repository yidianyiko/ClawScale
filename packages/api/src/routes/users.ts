import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/index.js';
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

const memberSelect = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  lastActiveAt: true,
} as const;

export const usersRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/users ───────────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db.member.findMany({
      where: { tenantId },
      select: memberSelect,
    });

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/users — invite a new member ────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', inviteSchema), async (c) => {
    const { tenantId, userId: actorId } = c.get('auth');
    const body = c.req.valid('json');

    // Check plan limit
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const settings = tenant?.settings as { maxMembers?: number } | undefined;
    const maxMembers = settings?.maxMembers ?? 5;

    const activeCount = await db.member.count({
      where: { tenantId, isActive: true },
    });

    if (activeCount >= maxMembers) {
      return c.json({ ok: false, error: `Plan limit reached (${maxMembers} members max)` }, 422);
    }

    // Check duplicate email within tenant
    const existing = await db.member.findUnique({
      where: { tenantId_email: { tenantId, email: body.email.toLowerCase() } },
      select: { id: true },
    });

    if (existing) {
      return c.json({ ok: false, error: 'A member with this email already exists' }, 409);
    }

    const id = generateId('mbr');
    const passwordHash = await hashPassword(body.temporaryPassword);

    await db.member.create({
      data: {
        id,
        tenantId,
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash,
        role: body.role,
      },
    });

    await audit({ tenantId, memberId: actorId, action: 'invite_member', resource: 'member', resourceId: id });

    const created = await db.member.findUnique({ where: { id }, select: memberSelect });
    return c.json({ ok: true, data: created }, 201);
  })

  // ── GET /api/users/:id ───────────────────────────────────────────────────────
  .get('/:id', async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const member = await db.member.findFirst({
      where: { id, tenantId },
      select: memberSelect,
    });

    if (!member) return c.json({ ok: false, error: 'Member not found' }, 404);
    return c.json({ ok: true, data: member });
  })

  // ── PATCH /api/users/:id ─────────────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId: actorId } = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const existing = await db.member.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!existing) return c.json({ ok: false, error: 'Member not found' }, 404);

    await db.member.update({ where: { id }, data: body });

    await audit({ tenantId, memberId: actorId, action: 'update_member', resource: 'member', resourceId: id, meta: body });

    const updated = await db.member.findUnique({ where: { id }, select: memberSelect });
    return c.json({ ok: true, data: updated });
  })

  // ── DELETE /api/users/:id — deactivate (not hard delete) ────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId: actorId } = c.get('auth');
    const id = c.req.param('id');

    if (id === actorId) {
      return c.json({ ok: false, error: 'You cannot deactivate your own account' }, 422);
    }

    const existing = await db.member.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!existing) return c.json({ ok: false, error: 'Member not found' }, 404);

    await db.member.update({ where: { id }, data: { isActive: false } });

    await audit({ tenantId, memberId: actorId, action: 'deactivate_member', resource: 'member', resourceId: id });

    return c.json({ ok: true, data: null });
  });
