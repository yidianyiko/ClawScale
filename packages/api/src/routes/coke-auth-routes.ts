import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ensureClawscaleUserForCustomer } from '../lib/clawscale-user.js';
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
import {
  CustomerAuthError,
  authenticateCustomer,
  registerCustomer,
  signCustomerToken,
  type CustomerAuthResult,
} from '../lib/customer-auth.js';
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

type CompatibilityCokeAccount = {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  status: 'normal' | 'suspended';
  passwordHash: string | null;
};

function withCompatibilityCustomerAuth<T extends { token: string; user: object }>(
  data: T,
  customerAuth: CustomerAuthResult | null,
): T & { customerAuth?: CustomerAuthResult } {
  if (!customerAuth) {
    return data;
  }

  return {
    ...data,
    customerAuth,
  };
}

function applyDeprecationHeaders(c: Context, successorPath: string): void {
  c.header('Deprecation', 'true');
  c.header('Link', `<${successorPath}>; rel="successor-version"`);
}

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

function mapCustomerAuthError(error: unknown): {
  status: 400 | 401 | 404 | 409;
  body: { ok: false; error: string };
} {
  if (!(error instanceof CustomerAuthError)) {
    throw error;
  }

  switch (error.code) {
    case 'email_already_exists':
      return { status: 409, body: { ok: false, error: error.code } };
    case 'invalid_credentials':
      return { status: 401, body: { ok: false, error: error.code } };
    case 'invalid_or_expired_token':
      return { status: 400, body: { ok: false, error: error.code } };
    case 'account_not_found':
      return { status: 404, body: { ok: false, error: error.code } };
  }
}

async function loadCompatibilityCokeAccount(
  customerId: string,
  options: { provisionIfMissing: boolean },
): Promise<CompatibilityCokeAccount | null> {
  let account = await db.cokeAccount.findUnique({ where: { id: customerId } });
  if (!account && options.provisionIfMissing) {
    await ensureClawscaleUserForCustomer({ customerId });
    account = await db.cokeAccount.findUnique({ where: { id: customerId } });
  }

  return account;
}

async function loadCompatibilityCustomerAuth(customerId: string): Promise<CustomerAuthResult | null> {
  const membership = await db.membership.findFirst({
    where: {
      customerId,
      role: 'owner',
    },
    include: {
      customer: {
        select: {
          id: true,
        },
      },
      identity: {
        select: {
          id: true,
          email: true,
          claimStatus: true,
        },
      },
    },
  });

  const email = membership?.identity.email?.trim();
  if (!membership || !email) {
    return null;
  }

  return {
    customerId: membership.customer.id,
    identityId: membership.identity.id,
    claimStatus: membership.identity.claimStatus,
    email,
    membershipRole: membership.role,
    token: signCustomerToken({
      customerId: membership.customer.id,
      identityId: membership.identity.id,
      email,
    }),
  };
}

async function authenticateLegacyCokeAccount(input: {
  email: string;
  password: string;
}): Promise<CompatibilityCokeAccount | null> {
  const account = await db.cokeAccount.findUnique({
    where: { email: normalizeEmail(input.email) },
  });

  if (!account?.passwordHash) {
    return null;
  }

  const valid = await verifyPassword(input.password, account.passwordHash);
  if (!valid) {
    return null;
  }

  return account;
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
    applyDeprecationHeaders(c, '/api/auth/register');
    try {
      const result = await registerCustomer(db as never, c.req.valid('json'));
      await ensureClawscaleUserForCustomer({ customerId: result.customerId });
      const compatibilityAccount = await db.cokeAccount.update({
        where: { id: result.customerId },
        data: { emailVerified: false },
      });

      try {
        await sendVerificationEmail({
          id: compatibilityAccount.id,
          email: compatibilityAccount.email,
        });
      } catch (error) {
        console.error('[coke-auth] failed to send verification email after registration', {
          accountId: compatibilityAccount.id,
          email: compatibilityAccount.email,
          error,
        });
      }

      return c.json(
        {
          ok: true,
          data: withCompatibilityCustomerAuth(
            {
              token: signCokeToken({ sub: result.customerId, email: result.email }),
              user: serializeCokeAccount(compatibilityAccount),
            },
            result,
          ),
        },
        201,
      );
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .post('/login', zValidator('json', loginSchema), async (c) => {
    applyDeprecationHeaders(c, '/api/auth/login');
    const input = c.req.valid('json');
    try {
      const result = await authenticateCustomer(db as never, input);
      const account = await loadCompatibilityCokeAccount(result.customerId, {
        provisionIfMissing: true,
      });

      if (!account) {
        return c.json({ ok: false, error: 'account_not_found' }, 404);
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
        data: withCompatibilityCustomerAuth(
          {
            token: signCokeToken({ sub: result.customerId, email: result.email }),
            user: withSubscriptionState(serializeCokeAccount(account), access),
          },
          result,
        ),
      });
    } catch (error) {
      if (error instanceof CustomerAuthError && error.code === 'invalid_credentials') {
        const legacyAccount = await authenticateLegacyCokeAccount(input);
        if (!legacyAccount) {
          return c.json({ ok: false, error: 'invalid_credentials' }, 401);
        }

        if (legacyAccount.status !== 'normal') {
          return c.json({ ok: false, error: 'account_suspended' }, 403);
        }

        const access = await resolveCokeAccountAccess({
          account: {
            id: legacyAccount.id,
            status: legacyAccount.status,
            emailVerified: legacyAccount.emailVerified,
            displayName: legacyAccount.displayName,
          },
        });

        return c.json({
          ok: true,
          data: {
            token: signCokeToken({ sub: legacyAccount.id, email: legacyAccount.email }),
            user: withSubscriptionState(serializeCokeAccount(legacyAccount), access),
          },
        });
      }

      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .post('/verify-email', zValidator('json', verifyEmailSchema), async (c) => {
    applyDeprecationHeaders(c, '/api/auth/verify-email');
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
    const customerAuth = await loadCompatibilityCustomerAuth(updatedAccount.id);

    return c.json({
      ok: true,
      data: withCompatibilityCustomerAuth(
        {
          token: signCokeToken({ sub: updatedAccount.id, email: updatedAccount.email }),
          user: withSubscriptionState(serializeCokeAccount(updatedAccount), access),
        },
        customerAuth,
      ),
    });
  })
  .post('/verify-email/resend', zValidator('json', emailOnlySchema), async (c) => {
    applyDeprecationHeaders(c, '/api/auth/resend-verification');
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
    applyDeprecationHeaders(c, '/api/auth/forgot-password');
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
    applyDeprecationHeaders(c, '/api/auth/reset-password');
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
    const ownerMembership = await db.membership.findFirst({
      where: {
        customerId: token.account.id,
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            id: true,
          },
        },
        identity: {
          select: {
            claimStatus: true,
            email: true,
            id: true,
            passwordHash: true,
          },
        },
      },
    });

    if (!ownerMembership?.identity.id) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    await db.$transaction(async (tx) => {
      await tx.identity.update({
        where: { id: ownerMembership.identity.id },
        data: { passwordHash },
      });

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
  .use('/me', async (c, next) => {
    applyDeprecationHeaders(c, '/api/auth/me');
    await next();
  })
  .get('/me', requireCokeUserAuth, async (c) => {
    const auth = c.get('cokeAuth');
    const account = await loadCompatibilityCokeAccount(auth.accountId, {
      provisionIfMissing: auth.accountId.startsWith('ck_'),
    });

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
