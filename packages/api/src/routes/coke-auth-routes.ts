import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ensureClawscaleUserForCokeAccount } from '../lib/clawscale-user.js';
import { sendCokeEmail } from '../lib/email.js';
import {
  hashPassword,
  issueVerifyToken,
  normalizeEmail,
  signCokeToken,
  verifyPassword,
} from '../lib/coke-auth.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { requireCokeUserAuth } from '../middleware/coke-user-auth.js';

const registerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return undefined;
  }

  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getVerifyEmailUrl(token: string, email: string): string {
  const domainClient = process.env['DOMAIN_CLIENT']?.replace(/\/$/, '') ?? '';
  return `${domainClient}/coke/verify-email?token=${token}&email=${email}`;
}

function serializeCokeAccount(account: {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  status: 'normal' | 'suspended';
}) {
  return {
    id: account.id,
    email: account.email,
    display_name: account.displayName,
    email_verified: account.emailVerified,
    status: account.status,
  };
}

function withSubscriptionState(
  user: ReturnType<typeof serializeCokeAccount>,
  access: Awaited<ReturnType<typeof resolveCokeAccountAccess>>,
) {
  return {
    ...user,
    subscription_active: access.subscriptionActive,
    subscription_expires_at: access.subscriptionExpiresAt,
  };
}

export const cokeAuthRouter = new Hono()
  .post('/register', zValidator('json', registerSchema), async (c) => {
    const input = c.req.valid('json');
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();

    const existing = await db.cokeAccount.findUnique({ where: { email } });
    if (existing) {
      return c.json({ ok: false, error: 'email_already_exists' }, 409);
    }

    const passwordHash = await hashPassword(input.password);
    const created = await db.cokeAccount.create({
      data: {
        email,
        displayName,
        passwordHash,
      },
    });

    await ensureClawscaleUserForCokeAccount({
      cokeAccountId: created.id,
      displayName: created.displayName,
    });

    const { plainToken, tokenHash } = issueVerifyToken();
    await db.verifyToken.create({
      data: {
        cokeAccountId: created.id,
        tokenHash,
        type: 'email_verify',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    await sendCokeEmail({
      to: created.email,
      subject: 'Verify your Coke email',
      html: `<a href="${getVerifyEmailUrl(plainToken, created.email)}">Verify your email</a>`,
    });

    return c.json(
      {
        ok: true,
        data: {
          token: signCokeToken({ sub: created.id, email: created.email }),
          user: serializeCokeAccount(created),
        },
      },
      201,
    );
  })
  .post('/login', zValidator('json', loginSchema), async (c) => {
    const input = c.req.valid('json');
    const email = normalizeEmail(input.email);

    const account = await db.cokeAccount.findUnique({ where: { email } });
    if (!account) {
      return c.json({ ok: false, error: 'invalid_credentials' }, 401);
    }

    const valid = await verifyPassword(input.password, account.passwordHash);
    if (!valid) {
      return c.json({ ok: false, error: 'invalid_credentials' }, 401);
    }

    if (account.status !== 'normal') {
      return c.json({ ok: false, error: 'account_suspended' }, 403);
    }

    const access = await resolveCokeAccountAccess({
      account: {
        id: account.id,
        status: account.status,
        emailVerified: account.emailVerified,
        displayName: account.displayName,
      },
    });

    return c.json({
      ok: true,
      data: {
        token: signCokeToken({ sub: account.id, email: account.email }),
        user: withSubscriptionState(serializeCokeAccount(account), access),
      },
    });
  })
  .get('/me', requireCokeUserAuth, async (c) => {
    const auth = c.get('cokeAuth');
    const account = await db.cokeAccount.findUnique({ where: { id: auth.accountId } });

    if (!account) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    const access = await resolveCokeAccountAccess({
      account: {
        id: account.id,
        status: account.status,
        emailVerified: account.emailVerified,
        displayName: account.displayName,
      },
    });

    return c.json({
      ok: true,
      data: withSubscriptionState(serializeCokeAccount(account), access),
    });
  });
