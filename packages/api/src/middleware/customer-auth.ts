import type { Context, Next } from 'hono';
import { db } from '../db/index.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';

export interface CustomerAuthContext extends CustomerSession {}

declare module 'hono' {
  interface ContextVariableMap {
    customerAuth: CustomerAuthContext;
  }
}

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export async function requireCustomerAuth(c: Context, next: Next): Promise<Response | void> {
  const token = readBearerToken(c);
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

  if (session.claimStatus !== 'active') {
    return c.json({ ok: false, error: 'claim_inactive' }, 403);
  }

  c.set('customerAuth', session);
  await next();
}
