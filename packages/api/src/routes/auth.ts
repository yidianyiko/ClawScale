import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import slugify from 'slugify';
import { db } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
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
  maxUsers: 5,
  maxChannels: 3,
  features: { sharedMemory: true, privateThreads: true, knowledgeBase: false },
};

export const authRouter = new Hono()

  // ── POST /auth/register ──────────────────────────────────────────────────────
  .post('/register', zValidator('json', registerSchema), async (c) => {
    const body = c.req.valid('json');

    const slug = slugify(body.tenantSlug, { lower: true, strict: true });

    // Tenant slug must be unique
    const existing = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ ok: false, error: 'Workspace slug is already taken' }, 409);
    }

    const tenantId = generateId('tnt');
    const userId = generateId('usr');
    const passwordHash = await hashPassword(body.password);

    await db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id: tenantId,
        slug,
        name: body.tenantName,
        plan: 'starter',
        settings: defaultSettings,
      });
      await tx.insert(users).values({
        id: userId,
        tenantId,
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash,
        role: 'admin',
      });
    });

    const token = signToken({ sub: userId, tid: tenantId, role: 'admin' });

    await audit({ tenantId, userId, action: 'register', resource: 'tenant', resourceId: tenantId });

    const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const user = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
        lastActiveAt: users.lastActiveAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return c.json({
      ok: true,
      data: {
        tokens: { accessToken: token, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() },
        user: user[0],
        tenant: tenant[0],
      },
    });
  })

  // ── POST /auth/login ─────────────────────────────────────────────────────────
  .post('/login', zValidator('json', loginSchema), async (c) => {
    const { email, password } = c.req.valid('json');

    const result = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), eq(users.isActive, true)))
      .limit(1);

    const user = result[0];
    if (!user) {
      return c.json({ ok: false, error: 'Invalid email or password' }, 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return c.json({ ok: false, error: 'Invalid email or password' }, 401);
    }

    // Update lastActiveAt
    await db
      .update(users)
      .set({ lastActiveAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const token = signToken({ sub: user.id, tid: user.tenantId, role: user.role });

    const tenant = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);

    await audit({ tenantId: user.tenantId, userId: user.id, action: 'login', resource: 'session' });

    return c.json({
      ok: true,
      data: {
        tokens: { accessToken: token, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() },
        user: {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          lastActiveAt: user.lastActiveAt,
        },
        tenant: tenant[0],
      },
    });
  })

  // ── GET /auth/me ─────────────────────────────────────────────────────────────
  .get('/me', requireAuth, async (c) => {
    const { userId, tenantId } = c.get('auth');

    const [userRow] = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
        lastActiveAt: users.lastActiveAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userRow) {
      return c.json({ ok: false, error: 'User not found' }, 404);
    }

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

    return c.json({ ok: true, data: { user: userRow, tenant } });
  });
