import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { CustomerAuthError } from '../lib/customer-auth.js';
import { completeCustomerClaim } from '../lib/claim-token.js';

const claimSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8),
});

function mapCustomerAuthError(error: unknown): {
  status: 400 | 404;
  body: { ok: false; error: string };
} {
  if (!(error instanceof CustomerAuthError)) {
    throw error;
  }

  switch (error.code) {
    case 'invalid_or_expired_token':
      return { status: 400, body: { ok: false, error: error.code } };
    case 'account_not_found':
      return { status: 404, body: { ok: false, error: error.code } };
    default:
      throw error;
  }
}

export const customerClaimRouter = new Hono().post(
  '/',
  zValidator('json', claimSchema),
  async (c) => {
    try {
      const result = await completeCustomerClaim(db as never, c.req.valid('json'));
      return c.json({ ok: true, data: result });
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  },
);
