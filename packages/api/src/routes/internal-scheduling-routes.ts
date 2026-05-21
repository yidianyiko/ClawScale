import type { Context } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  confirmBookableWindowPreview,
  previewBookableWindows,
} from '../scheduling/availability-service.js';
import {
  cancelAppointment,
  confirmAppointment,
  listPendingRequests,
  queryBookableWindows,
  rejectAppointment,
  requestAppointment,
} from '../scheduling/appointment-service.js';
import { retryPendingSchedulingNotifications } from '../scheduling/notification-service.js';
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

type JsonRecord = Record<string, unknown>;

export const internalSchedulingRouter = new Hono();

function isAuthorized(header: string | undefined): boolean {
  const expected = process.env['CLAWSCALE_IDENTITY_API_KEY']?.trim();
  return Boolean(expected) && header === `Bearer ${expected}`;
}

async function readJsonObject(c: Context): Promise<JsonRecord | null> {
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

function optionalStringField(body: JsonRecord, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(body: JsonRecord, key: string, fallback: number): number {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

internalSchedulingRouter.post('/tools/:toolName', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  const toolName = c.req.param('toolName');
  const customerId = stringField(body, 'customer_id');
  const consumerAccountId = stringField(body, 'consumer_account_id');

  try {
    if (toolName === 'get_user_link') {
      const result = await getOrCreateActiveUserLink(db as never, {
        providerAccountId: customerId,
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'reset_user_link') {
      const result = await resetUserLink(db as never, {
        providerAccountId: customerId,
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'disable_user_link') {
      const result = await disableUserLink(db as never, {
        providerAccountId: customerId,
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'open_bookable_windows') {
      const result = await previewBookableWindows({
        providerAccountId: customerId,
        instruction: stringField(body, 'instruction'),
        timezone: stringField(body, 'timezone', 'UTC'),
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'confirm_bookable_windows') {
      if (typeof body['preview'] !== 'object' || body['preview'] === null) {
        return c.json({ ok: false, error: 'invalid_body' }, 400);
      }
      const result = await confirmBookableWindowPreview(db as never, {
        providerAccountId: customerId,
        preview: body['preview'] as never,
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'list_pending_requests') {
      const result = await listPendingRequests(db as never, {
        providerAccountId: customerId,
        now: new Date(),
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'query_bookable_windows') {
      const result = await queryBookableWindows(db as never, {
        providerAccountId: customerId,
        consumerAccountId,
        dateFrom: stringField(body, 'date_from'),
        dateTo: optionalStringField(body, 'date_to'),
        viewerTimezone: optionalStringField(body, 'viewer_timezone'),
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'request_appointment') {
      const result = await requestAppointment(db as never, {
        providerAccountId: customerId,
        consumerAccountId,
        bookableWindowId: stringField(body, 'bookable_window_id'),
        instanceStart: stringField(body, 'instance_start'),
        instanceEnd: stringField(body, 'instance_end'),
        timezone: stringField(body, 'timezone', 'UTC'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      });
      return c.json({ ok: true, data: result }, 201);
    }
    if (toolName === 'confirm_appointment') {
      const result = await confirmAppointment(db as never, {
        actorAccountId: customerId,
        requestId: stringField(body, 'request_id'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'reject_appointment') {
      const result = await rejectAppointment(db as never, {
        actorAccountId: customerId,
        requestId: stringField(body, 'request_id'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'cancel_appointment') {
      const result = await cancelAppointment(db as never, {
        actorAccountId: customerId,
        requestId: stringField(body, 'request_id'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'block_service_link') {
      const result = await blockServiceLink(db as never, {
        providerAccountId: customerId,
        consumerAccountId,
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'unblock_service_link') {
      const result = await unblockServiceLink(db as never, {
        providerAccountId: customerId,
        consumerAccountId,
      });
      return c.json({ ok: true, data: result });
    }
    if (toolName === 'remove_service_link') {
      const existing = await db.serviceLink.findFirst({
        where: {
          providerAccountId: customerId,
          consumerAccountId,
        },
      });
      if (!existing) {
        return c.json({ ok: false, error: 'service_link_not_found' }, 404);
      }
      const result = await removeServiceLink(db as never, {
        serviceLinkId: existing.id,
      });
      return c.json({ ok: true, data: result });
    }

    return c.json({ ok: false, error: 'unknown_tool' }, 404);
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'scheduling_failed') }, 400);
  }
});

internalSchedulingRouter.post('/notifications/retry', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = (await readJsonObject(c)) ?? {};
  try {
    const result = await retryPendingSchedulingNotifications(db as never, {
      limit: numberField(body, 'limit', 10),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error, 'retry_failed') }, 400);
  }
});
