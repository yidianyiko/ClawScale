import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { CustomerAuthError, normalizeEmail } from '../lib/customer-auth.js';
import { sendCustomerClaimEmail } from '../lib/customer-email.js';
import {
  completeCustomerClaim,
  issueClaimToken,
  sanitizeContinueTo,
  verifyClaimEntryToken,
} from '../lib/claim-token.js';

const claimSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8),
});

const claimRequestSchema = z.object({
  entryToken: z.string().trim().min(1),
  email: z.string().trim().email(),
  next: z.string().trim().optional(),
});

function mapCustomerAuthError(error: unknown): {
  status: 400 | 404 | 409;
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
    case 'email_already_exists':
      return { status: 409, body: { ok: false, error: error.code } };
    case 'claim_not_allowed':
      return { status: 409, body: { ok: false, error: error.code } };
    default:
      throw error;
  }
}

async function ensureClaimEmailAvailable(email: string, identityId: string): Promise<void> {
  const existing = await db.identity.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true },
  });

  if (existing && existing.id !== identityId) {
    throw new CustomerAuthError('email_already_exists');
  }
}

export const customerClaimRouter = new Hono()
  .post('/request', zValidator('json', claimRequestSchema), async (c) => {
    try {
      const body = c.req.valid('json');
      const verified = verifyClaimEntryToken(body.entryToken);
      const continueTo = sanitizeContinueTo(body.next) ?? verified.continueTo;

      await ensureClaimEmailAvailable(body.email, verified.identityId);

      const issued = await issueClaimToken(db as never, {
        customerId: verified.customerId,
        identityId: verified.identityId,
        email: body.email,
        continueTo,
      });

      await sendCustomerClaimEmail({
        to: issued.email,
        token: issued.token,
      });

      return c.json({ ok: true, data: { message: 'claim_email_sent' } });
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  .post('/', zValidator('json', claimSchema), async (c) => {
    try {
      const result = await completeCustomerClaim(db as never, c.req.valid('json'));
      return c.json({ ok: true, data: result });
    } catch (error) {
      const failure = mapCustomerAuthError(error);
      return c.json(failure.body, failure.status);
    }
  });
