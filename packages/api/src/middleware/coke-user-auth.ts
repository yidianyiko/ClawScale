import type { Context, Next } from 'hono';
import { verifyCokeToken, type CokeJwtPayload } from '../lib/coke-auth.js';

export interface CokeAuthContext {
  accountId: string;
  email: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    cokeAuth: CokeAuthContext;
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

export async function requireCokeUserAuth(c: Context, next: Next): Promise<Response | void> {
  const token = readBearerToken(c);
  if (!token) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let payload: CokeJwtPayload;
  try {
    payload = verifyCokeToken(token);
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }

  c.set('cokeAuth', { accountId: payload.sub, email: payload.email });
  await next();
}
