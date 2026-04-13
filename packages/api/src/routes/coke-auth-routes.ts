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
  sha256Hex,
  signCokeToken,
  verifyPassword,
} from '../lib/coke-auth.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { requireCokeUserAuth } from '../middleware/coke-user-auth.js';

const VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000;
const VERIFY_EMAIL_SENT_MESSAGE = 'If the account exists, a verification email has been sent.';
const PASSWORD_RESET_SENT_MESSAGE = 'Password reset instructions were sent if the account exists.';

const registerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const verifyEmailSchema = z.object({
  email: z.string().trim().email(),
  token: z.string().trim().min(1),
});

const emailOnlySchema = z.object({
  email: z.string().trim().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8),
});

function getDomainClient(): string {
  return process.env['DOMAIN_CLIENT']?.replace(/\/$/, '') ?? '';
}

function getVerifyEmailUrl(token: string, email: string): string {
  return `${getDomainClient()}/coke/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

function getResetPasswordUrl(token: string): string {
  return `${getDomainClient()}/coke/reset-password?token=${encodeURIComponent(token)}`;
}

function createTokenExpiry(): Date {
  return new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
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

function isTokenExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

async function sendVerificationEmail(account: { id: string; email: string }): Promise<void> {
  const issued = issueVerifyToken();
  await db.verifyToken.create({
    data: {
      cokeAccountId: account.id,
      tokenHash: issued.tokenHash,
      type: 'email_verify',
      expiresAt: createTokenExpiry(),
    },
  });

  await sendCokeEmail({
    to: account.email,
    subject: 'Verify your Coke email',
    html: `<a href="${getVerifyEmailUrl(issued.plainToken, account.email)}">Verify your email</a>`,
  });
}

async function sendPasswordResetEmail(account: { id: string; email: string }): Promise<void> {
  const issued = issueVerifyToken();
  await db.verifyToken.create({
    data: {
      cokeAccountId: account.id,
      tokenHash: issued.tokenHash,
      type: 'password_reset',
      expiresAt: createTokenExpiry(),
    },
  });

  await sendCokeEmail({
    to: account.email,
    subject: 'Reset your Coke password',
    html: `<a href="${getResetPasswordUrl(issued.plainToken)}">Reset your password</a>`,
  });
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

    await sendVerificationEmail({ id: created.id, email: created.email });

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
  .post('/verify-email', zValidator('json', verifyEmailSchema), async (c) => {
    const input = c.req.valid('json');
    const email = normalizeEmail(input.email);
    const tokenHash = sha256Hex(input.token);

    const token = await db.verifyToken.findFirst({
      where: {
        tokenHash,
        type: 'email_verify',
        used: false,
        account: {
          is: {
            email,
          },
        },
      },
      include: {
        account: true,
      },
    });

    if (!token || isTokenExpired(token.expiresAt)) {
      return c.json({ ok: false, error: 'invalid_or_expired_token' }, 400);
    }

    if (!token.account) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    const updatedAccount = await db.$transaction(async (tx) => {
      const account = await tx.cokeAccount.update({
        where: { id: token.account.id },
        data: { emailVerified: true },
      });

      await tx.verifyToken.update({
        where: { id: token.id },
        data: { used: true },
      });

      return account;
    });

    const access = await resolveCokeAccountAccess({
      account: {
        id: updatedAccount.id,
        status: updatedAccount.status,
        emailVerified: updatedAccount.emailVerified,
        displayName: updatedAccount.displayName,
      },
    });

    return c.json({
      ok: true,
      data: {
        token: signCokeToken({ sub: updatedAccount.id, email: updatedAccount.email }),
        user: withSubscriptionState(serializeCokeAccount(updatedAccount), access),
      },
    });
  })
  .post('/verify-email/resend', zValidator('json', emailOnlySchema), async (c) => {
    const input = c.req.valid('json');
    const email = normalizeEmail(input.email);
    const account = await db.cokeAccount.findUnique({ where: { email } });

    if (!account || account.emailVerified) {
      return c.json({
        ok: true,
        data: {
          message: VERIFY_EMAIL_SENT_MESSAGE,
        },
      });
    }

    await db.verifyToken.deleteMany({
      where: {
        cokeAccountId: account.id,
        type: 'email_verify',
        used: false,
      },
    });

    await sendVerificationEmail({ id: account.id, email: account.email });

    return c.json({
      ok: true,
      data: {
        message: VERIFY_EMAIL_SENT_MESSAGE,
      },
    });
  })
  .post('/forgot-password', zValidator('json', emailOnlySchema), async (c) => {
    const input = c.req.valid('json');
    const email = normalizeEmail(input.email);
    const account = await db.cokeAccount.findUnique({ where: { email } });

    if (account) {
      await db.verifyToken.deleteMany({
        where: {
          cokeAccountId: account.id,
          type: 'password_reset',
          used: false,
        },
      });

      await sendPasswordResetEmail({ id: account.id, email: account.email });
    }

    return c.json({
      ok: true,
      data: {
        message: PASSWORD_RESET_SENT_MESSAGE,
      },
    });
  })
  .post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
    const input = c.req.valid('json');
    const tokenHash = sha256Hex(input.token);
    const token = await db.verifyToken.findFirst({
      where: {
        tokenHash,
        type: 'password_reset',
        used: false,
      },
      include: {
        account: true,
      },
    });

    if (!token || isTokenExpired(token.expiresAt)) {
      return c.json({ ok: false, error: 'invalid_or_expired_token' }, 400);
    }

    if (!token.account) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    const passwordHash = await hashPassword(input.password);
    await db.$transaction(async (tx) => {
      await tx.cokeAccount.update({
        where: { id: token.account.id },
        data: { passwordHash },
      });

      await tx.verifyToken.update({
        where: { id: token.id },
        data: { used: true },
      });
    });

    return c.json({
      ok: true,
      data: null,
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
