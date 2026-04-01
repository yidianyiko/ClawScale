import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import slugify from 'slugify';
import { db } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { generateId } from '../lib/id.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import type { TenantSettings } from '@clawscale/shared';

const registerSchema = z.object({
  tenantSlug: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  tenantName: z.string().min(2).max(80),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const defaultSettings: TenantSettings = {
  personaName: 'Assistant',
  personaPrompt: 'You are a helpful assistant.',
  endUserAccess: 'anonymous',
  features: { knowledgeBase: false },
};

const memberSelect = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  lastActiveAt: true,
} as const;

export const authRouter = new Hono()

  // ── POST /auth/register ──────────────────────────────────────────────────────
  .post('/register', zValidator('json', registerSchema), async (c) => {
    const body = c.req.valid('json');

    const slug = (slugify as any)(body.tenantSlug, { lower: true, strict: true }) as string;

    const existing = await db.tenant.findUnique({ where: { slug } });
    if (existing) {
      return c.json({ ok: false, error: 'Workspace slug is already taken' }, 409);
    }

    const tenantId = generateId('tnt');
    const memberId = generateId('mbr');
    const passwordHash = await hashPassword(body.password);

    await db.$transaction(async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          slug,
          name: body.tenantName,
          settings: defaultSettings as object,
        },
      });
      await tx.member.create({
        data: {
          id: memberId,
          tenantId,
          email: body.email.toLowerCase(),
          name: body.name,
          passwordHash,
          role: 'admin',
        },
      });
    });

    const token = signToken({ sub: memberId, tid: tenantId, role: 'admin' });

    await audit({ tenantId, memberId, action: 'register', resource: 'tenant', resourceId: tenantId });

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const member = await db.member.findUnique({ where: { id: memberId }, select: memberSelect });

    return c.json({
      ok: true,
      data: {
        tokens: { accessToken: token, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() },
        user: member,
        tenant,
      },
    });
  })

  // ── POST /auth/login ─────────────────────────────────────────────────────────
  .post('/login', zValidator('json', loginSchema), async (c) => {
    const { email, password } = c.req.valid('json');

    const member = await db.member.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
    });

    if (!member) {
      return c.json({ ok: false, error: 'Invalid email or password' }, 401);
    }

    const valid = await verifyPassword(password, member.passwordHash);
    if (!valid) {
      return c.json({ ok: false, error: 'Invalid email or password' }, 401);
    }

    await db.member.update({
      where: { id: member.id },
      data: { lastActiveAt: new Date() },
    });

    const token = signToken({ sub: member.id, tid: member.tenantId, role: member.role });

    const tenant = await db.tenant.findUnique({ where: { id: member.tenantId } });

    await audit({ tenantId: member.tenantId, memberId: member.id, action: 'login', resource: 'session' });

    return c.json({
      ok: true,
      data: {
        tokens: { accessToken: token, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() },
        user: {
          id: member.id,
          tenantId: member.tenantId,
          email: member.email,
          name: member.name,
          role: member.role,
          createdAt: member.createdAt,
          lastActiveAt: member.lastActiveAt,
        },
        tenant,
      },
    });
  })

  // ── GET /auth/me ─────────────────────────────────────────────────────────────
  .get('/me', requireAuth, async (c) => {
    const { userId, tenantId } = c.get('auth');

    const member = await db.member.findUnique({
      where: { id: userId },
      select: memberSelect,
    });

    if (!member) {
      return c.json({ ok: false, error: 'Member not found' }, 404);
    }

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });

    return c.json({ ok: true, data: { user: member, tenant } });
  })

  // ── DELETE /auth/account ────────────────────────────────────────────────────
  .delete('/account', requireAuth, async (c) => {
    const { userId, tenantId } = c.get('auth');

    const member = await db.member.findUnique({ where: { id: userId } });
    if (!member) {
      return c.json({ ok: false, error: 'Member not found' }, 404);
    }

    // If user is the only admin, prevent deletion to avoid orphaning the tenant
    if (member.role === 'admin') {
      const adminCount = await db.member.count({
        where: { tenantId, role: 'admin', isActive: true },
      });
      if (adminCount <= 1) {
        return c.json(
          { ok: false, error: 'You are the only admin. Transfer ownership or delete the workspace first.' },
          422,
        );
      }
    }

    await audit({ tenantId, memberId: userId, action: 'delete_own_account', resource: 'member', resourceId: userId });

    // Hard delete — cascades to sessions and sets auditLog.memberId to null
    await db.member.delete({ where: { id: userId } });

    return c.json({ ok: true, data: null });
  });
