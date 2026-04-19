import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { signCokeToken } from '../lib/coke-auth.js';
import {
  CustomerAuthError,
  authenticateCustomer,
  type CustomerAuthResult,
} from '../lib/customer-auth.js';
import { requireCokeUserAuth } from '../middleware/coke-user-auth.js';

const VERIFY_EMAIL_SENT_MESSAGE = 'If the account exists, a verification email has been sent.';
const PASSWORD_RESET_SENT_MESSAGE = 'Password reset instructions were sent if the account exists.';
const TEMPORARILY_PAUSED_ERROR = 'temporarily_paused';

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

type CompatibilityCustomerProfile = {
  customerId: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
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

function pausedResponse(c: Context, successorPath: string): Response {
  applyDeprecationHeaders(c, successorPath);
  return c.json({ ok: false, error: TEMPORARILY_PAUSED_ERROR }, 503);
}

function serializeCompatibilityCustomer(account: CompatibilityCustomerProfile) {
  return {
    id: account.customerId,
    email: account.email,
    display_name: account.displayName,
    email_verified: account.emailVerified,
    status: 'normal' as const,
  };
}

function withSubscriptionState(
  user: ReturnType<typeof serializeCompatibilityCustomer>,
  access: Awaited<ReturnType<typeof resolveCokeAccountAccess>>,
) {
  return {
    ...user,
    subscription_active: access.subscriptionActive,
    subscription_expires_at: access.subscriptionExpiresAt,
  };
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

async function loadCompatibilityCustomerProfile(
  customerId: string,
): Promise<CompatibilityCustomerProfile | null> {
  const membership = await db.membership.findFirst({
    where: {
      customerId,
      role: 'owner',
    },
    include: {
      customer: {
        select: {
          displayName: true,
          id: true,
        },
      },
      identity: {
        select: {
          claimStatus: true,
          email: true,
          id: true,
        },
      },
    },
  });

  const email = membership?.identity.email?.trim();
  const displayName = membership?.customer.displayName?.trim();
  if (
    !membership ||
    !membership.customer.id.startsWith('ck_') ||
    !email ||
    !displayName
  ) {
    return null;
  }

  return {
    customerId: membership.customer.id,
    displayName,
    email,
    emailVerified: membership.identity.claimStatus === 'active',
  };
}

export const cokeAuthRouter = new Hono()
  .post('/register', zValidator('json', registerSchema), async (c) => {
    return pausedResponse(c, '/api/auth/register');
  })
  .post('/login', zValidator('json', loginSchema), async (c) => {
    applyDeprecationHeaders(c, '/api/auth/login');
    const input = c.req.valid('json');

    try {
      const result = await authenticateCustomer(db as never, input);
      const profile = await loadCompatibilityCustomerProfile(result.customerId);

      if (!profile) {
        return c.json({ ok: false, error: 'account_not_found' }, 404);
      }

      const access = await resolveCokeAccountAccess({
        account: {
          id: profile.customerId,
          status: 'normal',
          emailVerified: profile.emailVerified,
          displayName: profile.displayName,
        },
      });

      return c.json({
        ok: true,
        data: withCompatibilityCustomerAuth(
          {
            token: signCokeToken({ sub: profile.customerId, email: profile.email }),
            user: withSubscriptionState(serializeCompatibilityCustomer(profile), access),
          },
          result,
        ),
      });
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .post('/verify-email', zValidator('json', verifyEmailSchema), async (c) => {
    return pausedResponse(c, '/api/auth/verify-email');
  })
  .post('/verify-email/resend', zValidator('json', emailOnlySchema), async (c) => {
    return pausedResponse(c, '/api/auth/resend-verification');
  })
  .post('/forgot-password', zValidator('json', emailOnlySchema), async (c) => {
    return pausedResponse(c, '/api/auth/forgot-password');
  })
  .post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
    return pausedResponse(c, '/api/auth/reset-password');
  })
  .use('/me', async (c, next) => {
    applyDeprecationHeaders(c, '/api/auth/me');
    await next();
  })
  .get('/me', requireCokeUserAuth, async (c) => {
    const auth = c.get('cokeAuth');
    const profile = await loadCompatibilityCustomerProfile(auth.accountId);

    if (!profile) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    const access = await resolveCokeAccountAccess({
      account: {
        id: profile.customerId,
        status: 'normal',
        emailVerified: profile.emailVerified,
        displayName: profile.displayName,
      },
    });

    return c.json({
      ok: true,
      data: withSubscriptionState(serializeCompatibilityCustomer(profile), access),
    });
  });
