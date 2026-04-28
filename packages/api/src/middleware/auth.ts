import type { Context, Next } from 'hono';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';

interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const token = header.slice(7);
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired token' }, 401);
  }

  c.set('auth', { userId: payload.sub, tenantId: payload.tid, role: payload.role });
  await next();
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const auth = c.get('auth');
  if (!auth) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }
  if (auth.role !== 'admin') {
    return c.json({ ok: false, error: 'Forbidden — admin role required' }, 403);
  }
  await next();
}
