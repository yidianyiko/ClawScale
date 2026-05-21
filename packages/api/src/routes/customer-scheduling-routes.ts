import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';
import {
  confirmBookableWindowPreview,
  previewBookableWindows,
} from '../scheduling/availability-service.js';
import {
  cancelAppointment,
  confirmAppointment,
  listPendingRequests,
  rejectAppointment,
  requestAppointment,
} from '../scheduling/appointment-service.js';
import {
  blockServiceLink,
  removeServiceLink,
  unblockServiceLink,
} from '../scheduling/service-link-service.js';
import {
  disableUserLink,
  getOrCreateActiveUserLink,
  resetUserLink,
} from '../scheduling/user-link-service.js';

declare module 'hono' {
  interface ContextVariableMap {
    customerSchedulingAuth: CustomerSession;
  }
}

type JsonRecord = Record<string, unknown>;

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

function stringField(body: JsonRecord, key: string, fallback = ''): string {
  const value = body[key];
  return typeof value === 'string' ? value : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function requestIdempotencyKey(
  body: JsonRecord,
  fallbackPrefix: string,
  customerId: string,
  id: string,
): string {
  return stringField(body, 'idempotencyKey') || `${fallbackPrefix}:${customerId}:${id}`;
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

customerSchedulingRouter.post('/bookable-windows/preview', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const body = await readJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    const result = await previewBookableWindows({
      providerAccountId: session.customerId,
      instruction: stringField(body, 'instruction'),
      timezone: stringField(body, 'timezone', 'UTC'),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'preview_failed') }, 400);
  }
});

customerSchedulingRouter.post('/bookable-windows/confirm', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const body = await readJsonObject(c);
  if (!body || typeof body['preview'] !== 'object' || body['preview'] === null) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    const result = await confirmBookableWindowPreview(db as never, {
      providerAccountId: session.customerId,
      preview: body['preview'] as never,
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'confirm_failed') }, 400);
  }
});

customerSchedulingRouter.get('/bookable-windows', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const windows = await db.bookableWindow.findMany({
    where: {
      providerAccountId: session.customerId,
      capability: 'appointment_request',
      status: 'active',
    },
    orderBy: { createdAt: 'desc' },
  });
  return c.json({ ok: true, data: windows });
});

customerSchedulingRouter.post('/appointments', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const body = await readJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    const result = await requestAppointment(db as never, {
      providerAccountId: stringField(body, 'providerAccountId'),
      consumerAccountId: session.customerId,
      bookableWindowId: stringField(body, 'bookableWindowId'),
      instanceStart: stringField(body, 'instanceStart'),
      instanceEnd: stringField(body, 'instanceEnd'),
      timezone: stringField(body, 'timezone', 'UTC'),
      idempotencyKey:
        stringField(body, 'idempotencyKey') ||
        `${session.customerId}:${stringField(body, 'bookableWindowId')}:${stringField(body, 'instanceStart')}`,
    });
    return c.json({ ok: true, data: result }, 201);
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'request_failed') }, 400);
  }
});

customerSchedulingRouter.get('/appointments/pending', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const result = await listPendingRequests(db as never, {
    providerAccountId: session.customerId,
    now: new Date(),
  });
  return c.json({ ok: true, data: result });
});

customerSchedulingRouter.post('/appointments/:id/confirm', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const requestId = c.req.param('id');
  const body = (await readJsonObject(c)) ?? {};
  try {
    const result = await confirmAppointment(db as never, {
      actorAccountId: session.customerId,
      requestId,
      idempotencyKey: requestIdempotencyKey(body, 'confirm', session.customerId, requestId),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'confirm_failed') }, 400);
  }
});

customerSchedulingRouter.post('/appointments/:id/reject', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const requestId = c.req.param('id');
  const body = (await readJsonObject(c)) ?? {};
  try {
    const result = await rejectAppointment(db as never, {
      actorAccountId: session.customerId,
      requestId,
      idempotencyKey: requestIdempotencyKey(body, 'reject', session.customerId, requestId),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'reject_failed') }, 400);
  }
});

customerSchedulingRouter.post('/appointments/:id/cancel', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const requestId = c.req.param('id');
  const body = (await readJsonObject(c)) ?? {};
  try {
    const result = await cancelAppointment(db as never, {
      actorAccountId: session.customerId,
      requestId,
      idempotencyKey: requestIdempotencyKey(body, 'cancel', session.customerId, requestId),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'cancel_failed') }, 400);
  }
});

customerSchedulingRouter.post('/service-links/:otherAccountId/block', async (c) => {
  const session = c.get('customerSchedulingAuth');
  try {
    const result = await blockServiceLink(db as never, {
      providerAccountId: session.customerId,
      consumerAccountId: c.req.param('otherAccountId'),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'block_failed') }, 400);
  }
});

customerSchedulingRouter.post('/service-links/:otherAccountId/unblock', async (c) => {
  const session = c.get('customerSchedulingAuth');
  try {
    const result = await unblockServiceLink(db as never, {
      providerAccountId: session.customerId,
      consumerAccountId: c.req.param('otherAccountId'),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'unblock_failed') }, 400);
  }
});

customerSchedulingRouter.delete('/service-links/:otherAccountId', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const existing = await db.serviceLink.findFirst({
    where: {
      OR: [
        { providerAccountId: session.customerId, consumerAccountId: c.req.param('otherAccountId') },
        { providerAccountId: c.req.param('otherAccountId'), consumerAccountId: session.customerId },
      ],
    },
  });
  if (!existing) {
    return c.json({ ok: false, error: 'service_link_not_found' }, 404);
  }

  try {
    const result = await removeServiceLink(db as never, {
      serviceLinkId: existing.id,
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'remove_failed') }, 400);
  }
});
