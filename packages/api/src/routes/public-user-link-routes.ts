import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';
import {
  createLinkSession,
  getLinkSessionStatus,
  readPublicUserLinkByCode,
  sendFriendRequestFromLinkSession,
} from '../scheduling/user-link-service.js';

export const publicUserLinkRouter = new Hono();
export const publicLinkSessionRouter = new Hono();

type JsonRecord = Record<string, unknown>;
type PublicFriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
type PublicFriendRequestResult = {
  id: string;
  status: PublicFriendRequestStatus;
};

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function readCustomerSession(c: Context): Promise<CustomerSession | null> {
  const token = readBearerToken(c);
  if (!token) {
    return null;
  }

  try {
    const payload = verifyCustomerToken(token);
    const session = await getCustomerSession(db as never, {
      customerId: payload.sub,
      identityId: payload.identityId,
    });
    return session?.claimStatus === 'active' ? session : null;
  } catch {
    return null;
  }
}

async function readJsonObject(c: Context): Promise<JsonRecord | null> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  try {
    const body = await c.req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return isKnownFriendRequestError(message) ? message : fallback;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requestIdempotencyKey(prefix: string, customerId: string, token: string): string {
  return `${prefix}:${customerId}:${sha256Hex(token)}`;
}

function readFriendRequestMessage(body: JsonRecord): { ok: true; message: string | null } | { ok: false } {
  const raw = body['message'];
  if (raw === undefined || raw === null) {
    return { ok: true, message: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false };
  }
  const message = raw.trim();
  if (message.length > 500) {
    return { ok: false };
  }
  return { ok: true, message: message || null };
}

function publicFriendRequestResult(result: Record<string, unknown>): PublicFriendRequestResult {
  return {
    id: String(result['id']),
    status: result['status'] as PublicFriendRequestStatus,
  };
}

function isKnownFriendRequestError(error: string): boolean {
  return (
    error === 'invalid_body' ||
    error === 'invalid_account' ||
    error === 'invalid_link_session' ||
    error === 'link_session_expired' ||
    error === 'cannot_friend_self' ||
    error === 'friend_request_blocked' ||
    error === 'friend_request_not_found' ||
    error === 'not_allowed'
  );
}

publicUserLinkRouter.get('/:code', async (c) => {
  try {
    const result = await readPublicUserLinkByCode(db as never, {
      code: c.req.param('code'),
    });
    if (!result) {
      return c.json({ ok: false, error: 'link_not_active' }, 404);
    }
    return c.json({ ok: true, data: result });
  } catch {
    return c.json({ ok: false, error: 'link_not_active' }, 404);
  }
});

publicUserLinkRouter.post('/:code/sessions', async (c) => {
  try {
    const result = await createLinkSession(db as never, {
      code: c.req.param('code'),
    });
    return c.json({ ok: true, data: result }, 201);
  } catch {
    return c.json({ ok: false, error: 'link_not_active' }, 404);
  }
});

publicLinkSessionRouter.get('/:token/status', async (c) => {
  try {
    const result = await getLinkSessionStatus(db as never, {
      token: c.req.param('token'),
    });
    return c.json({ ok: true, data: result });
  } catch {
    return c.json({ ok: false, error: 'link_session_not_found' }, 404);
  }
});

publicLinkSessionRouter.post('/:token/friend-requests', async (c) => {
  const session = await readCustomerSession(c);
  if (!session) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }
  const message = readFriendRequestMessage(body);
  if (!message.ok) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    const token = c.req.param('token');
    const result = await sendFriendRequestFromLinkSession(db as never, {
      token,
      requesterAccountId: session.customerId,
      message: message.message,
      idempotencyKey: requestIdempotencyKey('friend-request', session.customerId, token),
    });
    return c.json({ ok: true, data: publicFriendRequestResult(result) }, 201);
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'friend_request_failed') }, 400);
  }
});
