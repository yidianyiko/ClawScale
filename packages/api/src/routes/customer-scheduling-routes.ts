import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';
import {
  disableUserLink,
  getOrCreateActiveUserLink,
  resetUserLink,
} from '../scheduling/user-link-service.js';
import {
  acceptFriendRequest,
  blockAccount,
  cancelFriendRequest,
  listFriendRequests,
  listFriends,
  rejectFriendRequest,
  removeFriendship,
  unblockAccount,
} from '../scheduling/friendship-service.js';

declare module 'hono' {
  interface ContextVariableMap {
    customerSchedulingAuth: CustomerSession;
  }
}

export const customerSchedulingRouter = new Hono();

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function requireCustomerSchedulingAuth(c: Context, next: Next): Promise<Response | void> {
  const token = readBearerToken(c);
  if (!token) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const payload = verifyCustomerToken(token);
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

    c.set('customerSchedulingAuth', session);
    await next();
    return;
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }
}

function retiredAppointmentSchedulingResponse(c: Context): Response {
  return c.json({ ok: false, error: 'appointment_scheduling_retired' }, 410);
}

async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  try {
    const body = await c.req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isKnownSchedulingError(error: string): boolean {
  return (
    error === 'invalid_account' ||
    error === 'invalid_body' ||
    error === 'friend_request_not_found' ||
    error === 'friendship_not_found' ||
    error === 'cannot_friend_self' ||
    error === 'not_allowed'
  );
}

function schedulingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return isKnownSchedulingError(message) ? message : fallback;
}

function actionIdempotencyKey(action: string, actorAccountId: string, requestId: string): string {
  return `${action}:${actorAccountId}:${requestId}`;
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function friendRequestDto(row: Record<string, unknown>, accountId: string): Record<string, string> {
  const requesterAccountId = stringField(row, 'requesterAccountId');
  const targetAccountId = stringField(row, 'targetAccountId');
  const direction = targetAccountId === accountId ? 'incoming' : 'outgoing';
  const counterpartAccountId = targetAccountId === accountId ? requesterAccountId : targetAccountId;
  return {
    id: stringField(row, 'id'),
    status: stringField(row, 'status'),
    direction,
    counterpartAccountId,
  };
}

function friendRequestActionDto(row: Record<string, unknown>): Record<string, string> {
  return {
    id: stringField(row, 'id'),
    status: stringField(row, 'status'),
  };
}

function friendDto(row: Record<string, unknown>, accountId: string): Record<string, string> {
  const accountAId = stringField(row, 'accountAId');
  const accountBId = stringField(row, 'accountBId');
  return {
    id: stringField(row, 'id'),
    status: stringField(row, 'status'),
    counterpartAccountId: accountAId === accountId ? accountBId : accountAId,
  };
}

function blockDto(row: Record<string, unknown>): Record<string, string> {
  return {
    blockedAccountId: stringField(row, 'blockedAccountId'),
  };
}

customerSchedulingRouter.use('*', requireCustomerSchedulingAuth);

customerSchedulingRouter.get('/user-link', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const result = await getOrCreateActiveUserLink(db as never, {
    providerAccountId: session.customerId,
  });
  return c.json({ ok: true, data: result });
});

customerSchedulingRouter.post('/user-link/reset', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const result = await resetUserLink(db as never, {
    providerAccountId: session.customerId,
  });
  return c.json({ ok: true, data: result });
});

customerSchedulingRouter.post('/user-link/disable', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const result = await disableUserLink(db as never, {
    providerAccountId: session.customerId,
  });
  return c.json({ ok: true, data: result });
});

customerSchedulingRouter.get('/friend-requests', async (c) => {
  const session = c.get('customerSchedulingAuth');
  try {
    const result = await listFriendRequests(db as never, {
      accountId: session.customerId,
    });
    return c.json({
      ok: true,
      data: result.map((row) =>
        friendRequestDto(row as unknown as Record<string, unknown>, session.customerId),
      ),
    });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'friend_request_failed') }, 400);
  }
});

customerSchedulingRouter.post('/friend-requests/:id/accept', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const requestId = c.req.param('id');
  try {
    const result = await acceptFriendRequest(db as never, {
      actorAccountId: session.customerId,
      requestId,
      idempotencyKey: actionIdempotencyKey('accept', session.customerId, requestId),
    });
    return c.json({ ok: true, data: friendRequestActionDto(result as unknown as Record<string, unknown>) });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'friend_request_failed') }, 400);
  }
});

customerSchedulingRouter.post('/friend-requests/:id/reject', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const requestId = c.req.param('id');
  try {
    const result = await rejectFriendRequest(db as never, {
      actorAccountId: session.customerId,
      requestId,
      idempotencyKey: actionIdempotencyKey('reject', session.customerId, requestId),
    });
    return c.json({ ok: true, data: friendRequestActionDto(result as unknown as Record<string, unknown>) });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'friend_request_failed') }, 400);
  }
});

customerSchedulingRouter.post('/friend-requests/:id/cancel', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const requestId = c.req.param('id');
  try {
    const result = await cancelFriendRequest(db as never, {
      actorAccountId: session.customerId,
      requestId,
      idempotencyKey: actionIdempotencyKey('cancel', session.customerId, requestId),
    });
    return c.json({ ok: true, data: friendRequestActionDto(result as unknown as Record<string, unknown>) });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'friend_request_failed') }, 400);
  }
});

customerSchedulingRouter.get('/friends', async (c) => {
  const session = c.get('customerSchedulingAuth');
  try {
    const result = await listFriends(db as never, {
      accountId: session.customerId,
    });
    return c.json({
      ok: true,
      data: result.map((row) => friendDto(row as unknown as Record<string, unknown>, session.customerId)),
    });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'friendship_failed') }, 400);
  }
});

customerSchedulingRouter.delete('/friends/:friendshipId', async (c) => {
  const session = c.get('customerSchedulingAuth');
  try {
    const result = await removeFriendship(db as never, {
      actorAccountId: session.customerId,
      friendshipId: c.req.param('friendshipId'),
    });
    return c.json({ ok: true, data: friendRequestActionDto(result as Record<string, unknown>) });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'friendship_failed') }, 400);
  }
});

customerSchedulingRouter.post('/blocks', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const body = await readJsonObject(c);
  if (!body || typeof body['blockedAccountId'] !== 'string' || !body['blockedAccountId'].trim()) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }
  try {
    const result = await blockAccount(db as never, {
      blockerAccountId: session.customerId,
      blockedAccountId: body['blockedAccountId'].trim(),
    });
    return c.json({ ok: true, data: blockDto(result as Record<string, unknown>) });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'block_failed') }, 400);
  }
});

customerSchedulingRouter.delete('/blocks/:blockedAccountId', async (c) => {
  const session = c.get('customerSchedulingAuth');
  try {
    const result = await unblockAccount(db as never, {
      blockerAccountId: session.customerId,
      blockedAccountId: c.req.param('blockedAccountId'),
    });
    return c.json({ ok: true, data: blockDto(result as Record<string, unknown>) });
  } catch (error) {
    return c.json({ ok: false, error: schedulingError(error, 'block_failed') }, 400);
  }
});

customerSchedulingRouter.post('/bookable-windows/preview', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/bookable-windows/confirm', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.get('/bookable-windows', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.get('/appointments/pending', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments/:id/confirm', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments/:id/reject', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments/:id/cancel', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/service-links/:otherAccountId/block', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/service-links/:otherAccountId/unblock', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.delete('/service-links/:otherAccountId', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});
