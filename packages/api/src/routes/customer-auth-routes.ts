import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  CustomerAuthError,
  authenticateCustomer,
  getCustomerSession,
  issueCustomerActionToken,
  normalizeEmail,
  registerCustomer,
  resetCustomerPassword,
  verifyCustomerEmail,
  verifyCustomerToken,
} from '../lib/customer-auth.js';
import {
  sendCustomerPasswordResetEmail,
  sendCustomerVerificationEmail,
} from '../lib/customer-email.js';

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

type CustomerOwnershipRecord = {
  customer: {
    id: string;
  };
  identity: {
    id: string;
    email: string | null;
    claimStatus: 'active' | 'unclaimed' | 'pending';
    passwordHash?: string | null;
    updatedAt?: Date;
  };
};

function readBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
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

async function findSingleOwnerByEmail(email: string): Promise<CustomerOwnershipRecord | null> {
  const records = await db.membership.findMany({
    where: {
      role: 'owner',
      identity: {
        email,
      },
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
          updatedAt: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 2,
  });

  if (records.length !== 1 || !records[0]?.identity.email) {
    return null;
  }

  return records[0];
}

async function sendVerificationEmailForIdentity(record: CustomerOwnershipRecord): Promise<void> {
  await sendCustomerVerificationEmail({
    to: record.identity.email!,
    email: record.identity.email!,
    token: issueCustomerActionToken({
      purpose: 'verify_email',
      customerId: record.customer.id,
      identityId: record.identity.id,
      email: record.identity.email!,
      updatedAt: record.identity.updatedAt,
    }),
  });
}

async function sendPasswordResetEmailForIdentity(record: CustomerOwnershipRecord): Promise<void> {
  if (!record.identity.passwordHash || !record.identity.email) {
    return;
  }

  await sendCustomerPasswordResetEmail({
    to: record.identity.email,
    token: issueCustomerActionToken({
      purpose: 'password_reset',
      customerId: record.customer.id,
      identityId: record.identity.id,
      email: record.identity.email,
      passwordHash: record.identity.passwordHash,
    }),
  });
}

function logEmailFailure(action: 'registration' | 'resend_verification' | 'forgot_password', details: {
  customerId?: string;
  email: string;
  error: unknown;
}) {
  const label =
    action === 'registration'
      ? '[customer-auth] failed to send verification email after registration'
      : action === 'resend_verification'
        ? '[customer-auth] failed to resend verification email'
        : '[customer-auth] failed to send password reset email';

  console.error(label, details);
}

export const customerAuthRouter = new Hono()
  .post('/register', zValidator('json', registerSchema), async (c) => {
    try {
      const result = await registerCustomer(db as never, c.req.valid('json'));
      try {
        const ownership = await findSingleOwnerByEmail(normalizeEmail(result.email));
        if (ownership) {
          await sendVerificationEmailForIdentity(ownership);
        }
      } catch (error) {
        logEmailFailure('registration', {
          customerId: result.customerId,
          email: result.email,
          error,
        });
      }

      return c.json({ ok: true, data: result }, 201);
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .post('/login', zValidator('json', loginSchema), async (c) => {
    try {
      const result = await authenticateCustomer(db as never, c.req.valid('json'));
      return c.json({ ok: true, data: result });
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .post('/verify-email', zValidator('json', verifyEmailSchema), async (c) => {
    try {
      const result = await verifyCustomerEmail(db as never, c.req.valid('json'));
      return c.json({ ok: true, data: result });
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .post('/resend-verification', zValidator('json', emailOnlySchema), async (c) => {
    const input = c.req.valid('json');
    try {
      const ownership = await findSingleOwnerByEmail(normalizeEmail(input.email));
      if (ownership) {
        await sendVerificationEmailForIdentity(ownership);
      }
    } catch (error) {
      logEmailFailure('resend_verification', {
        customerId: undefined,
        email: normalizeEmail(input.email),
        error,
      });
    }

    return c.json({
      ok: true,
      data: {
        message: VERIFY_EMAIL_SENT_MESSAGE,
      },
    });
  })
  .post('/forgot-password', zValidator('json', emailOnlySchema), async (c) => {
    const input = c.req.valid('json');
    try {
      const ownership = await findSingleOwnerByEmail(normalizeEmail(input.email));
      if (ownership) {
        await sendPasswordResetEmailForIdentity(ownership);
      }
    } catch (error) {
      logEmailFailure('forgot_password', {
        customerId: undefined,
        email: normalizeEmail(input.email),
        error,
      });
    }

    return c.json({
      ok: true,
      data: {
        message: PASSWORD_RESET_SENT_MESSAGE,
      },
    });
  })
  .post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
    try {
      await resetCustomerPassword(db as never, c.req.valid('json'));
      return c.json({ ok: true, data: null });
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .get('/me', async (c) => {
    const token = readBearerToken(c.req.header('Authorization'));
    if (!token) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    let payload;
    try {
      payload = verifyCustomerToken(token);
    } catch {
      return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
    }

    const session = await getCustomerSession(db as never, {
      customerId: payload.sub,
      identityId: payload.identityId,
    });

    if (!session) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    return c.json({ ok: true, data: session });
  });
