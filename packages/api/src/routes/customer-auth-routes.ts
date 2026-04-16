import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  CustomerAuthError,
  authenticateCustomer,
  getCustomerSession,
  registerCustomer,
  resetCustomerPassword,
  verifyCustomerEmail,
  verifyCustomerToken,
} from '../lib/customer-auth.js';

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

function readBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

function mapCustomerAuthError(error: unknown): { status: number; body: { ok: false; error: string } } {
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

export const customerAuthRouter = new Hono()
  .post('/register', zValidator('json', registerSchema), async (c) => {
    try {
      const result = await registerCustomer(db as never, c.req.valid('json'));
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
    c.req.valid('json');
    return c.json({
      ok: true,
      data: {
        message: VERIFY_EMAIL_SENT_MESSAGE,
      },
    });
  })
  .post('/forgot-password', zValidator('json', emailOnlySchema), async (c) => {
    c.req.valid('json');
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
