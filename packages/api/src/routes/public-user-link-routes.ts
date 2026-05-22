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
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function requestIdempotencyKey(body: JsonRecord, prefix: string, customerId: string, token: string): string {
  const explicit = body['idempotencyKey'] ?? body['idempotency_key'];
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim();
  }
  return `${prefix}:${customerId}:${token}:${Date.now()}`;
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

publicLinkSessionRouter.post('/:token/claim', async (c) => {
  return c.json({ ok: false, error: 'appointment_scheduling_retired' }, 410);
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

  try {
    const token = c.req.param('token');
    const result = await sendFriendRequestFromLinkSession(db as never, {
      token,
      requesterAccountId: session.customerId,
      message: typeof body['message'] === 'string' ? body['message'] : null,
      idempotencyKey: requestIdempotencyKey(body, 'friend-request', session.customerId, token),
    });
    return c.json({ ok: true, data: result }, 201);
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'friend_request_failed') }, 400);
  }
});
