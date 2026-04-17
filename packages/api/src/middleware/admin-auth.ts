import type { Context, Next } from 'hono';
import { db } from '../db/index.js';
import { getAdminSession, verifyAdminToken, type AdminSession } from '../lib/admin-auth.js';

export interface AdminAuthContext extends AdminSession {}

declare module 'hono' {
  interface ContextVariableMap {
    adminAuth: AdminAuthContext;
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

export async function requireAdminAuth(c: Context, next: Next): Promise<Response | void> {
  const token = readBearerToken(c);
  if (!token) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let payload;
  try {
    payload = verifyAdminToken(token);
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }

  const session = await getAdminSession(db as never, {
    adminId: payload.sub,
  });

  if (!session) {
    return c.json({ ok: false, error: 'account_not_found' }, 404);
  }

  if (!session.isActive) {
    return c.json({ ok: false, error: 'inactive_account' }, 403);
  }

  c.set('adminAuth', session);
  await next();
}
