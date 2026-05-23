import type { Context } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  cancelRuntimeReminder,
  createRuntimeReminder,
  listRuntimeCalendarFacts,
} from '../lib/reminder-runtime-client.js';
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
import { listFriendCalendarFacts } from '../scheduling/friend-calendar-facts-service.js';
import { deliverPendingProductNotifications } from '../scheduling/notification-service.js';
import {
  acceptSharedReminder,
  cancelSharedReminder,
  createSharedReminder,
  listPendingSharedReminders,
  rejectSharedReminder,
} from '../scheduling/shared-reminder-service.js';
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

async function readOptionalJsonObject(c: Context): Promise<JsonRecord | null> {
  try {
    const text = await c.req.text();
    if (!text.trim()) {
      return {};
    }
    const body = JSON.parse(text);
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

function numberField(body: JsonRecord, key: string, fallback: number): number {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNumberField(body: JsonRecord, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function schedulingErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'scheduling_failed';
}

async function runActiveUserLinkTool<T>(
  c: Context,
  body: JsonRecord,
  fn: (customerId: string) => Promise<T>,
): Promise<Response> {
  const customerId = stringField(body, 'customer_id').trim();
  if (!customerId) {
    return c.json({ ok: false, error: 'invalid_customer_id' }, 400);
  }

  try {
    const result = await fn(customerId);
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: schedulingErrorCode(error) }, 400);
  }
}

async function runCustomerTool<T>(
  c: Context,
  body: JsonRecord,
  fn: (customerId: string) => Promise<T>,
  status = 200,
): Promise<Response> {
  const customerId = stringField(body, 'customer_id').trim();
  if (!customerId) {
    return c.json({ ok: false, error: 'invalid_customer_id' }, 400);
  }

  try {
    const result = await fn(customerId);
    return c.json({ ok: true, data: result }, status as never);
  } catch (error) {
    return c.json({ ok: false, error: schedulingErrorCode(error) }, 400);
  }
}

internalSchedulingRouter.post('/tools/:toolName', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const toolName = c.req.param('toolName');
  const body = await readJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  if (toolName === 'get_user_link') {
    return runActiveUserLinkTool(c, body, (customerId) =>
      getOrCreateActiveUserLink(db as never, {
        providerAccountId: customerId,
      }),
    );
  }
  if (toolName === 'reset_user_link') {
    return runActiveUserLinkTool(c, body, (customerId) =>
      resetUserLink(db as never, {
        providerAccountId: customerId,
      }),
    );
  }
  if (toolName === 'disable_user_link') {
    return runActiveUserLinkTool(c, body, (customerId) =>
      disableUserLink(db as never, {
        providerAccountId: customerId,
      }),
    );
  }
  if (toolName === 'list_friend_requests') {
    return runCustomerTool(c, body, (customerId) =>
      listFriendRequests(db as never, {
        accountId: customerId,
      }),
    );
  }
  if (toolName === 'accept_friend_request') {
    return runCustomerTool(c, body, (customerId) =>
      acceptFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: stringField(body, 'request_id'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'reject_friend_request') {
    return runCustomerTool(c, body, (customerId) =>
      rejectFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: stringField(body, 'request_id'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'cancel_friend_request') {
    return runCustomerTool(c, body, (customerId) =>
      cancelFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: stringField(body, 'request_id'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'list_friends') {
    return runCustomerTool(c, body, (customerId) =>
      listFriends(db as never, {
        accountId: customerId,
      }),
    );
  }
  if (toolName === 'remove_friendship') {
    return runCustomerTool(c, body, (customerId) =>
      removeFriendship(
        db as never,
        { cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          friendshipId: stringField(body, 'friendship_id'),
        },
      ),
    );
  }
  if (toolName === 'block_account') {
    return runCustomerTool(c, body, (customerId) =>
      blockAccount(
        db as never,
        { cancelRuntimeReminder },
        {
          blockerAccountId: customerId,
          blockedAccountId: stringField(body, 'blocked_account_id'),
        },
      ),
    );
  }
  if (toolName === 'unblock_account') {
    return runCustomerTool(c, body, (customerId) =>
      unblockAccount(db as never, {
        blockerAccountId: customerId,
        blockedAccountId: stringField(body, 'blocked_account_id'),
      }),
    );
  }
  if (toolName === 'list_friend_calendar_facts') {
    return runCustomerTool(c, body, (customerId) =>
      listFriendCalendarFacts(
        db as never,
        { listRuntimeCalendarFacts },
        {
          requesterAccountId: customerId,
          targetAccountId: stringField(body, 'target_account_id'),
          fromDate: stringField(body, 'from_date'),
          toDate: stringField(body, 'to_date'),
          timezone: stringField(body, 'timezone', 'UTC'),
        },
      ),
    );
  }
  if (toolName === 'create_shared_reminder') {
    return runCustomerTool(
      c,
      body,
      (customerId) =>
        createSharedReminder(
          db as never,
          { createRuntimeReminder, cancelRuntimeReminder },
          {
            requesterAccountId: customerId,
            inviteeAccountId: stringField(body, 'invitee_account_id'),
            title: stringField(body, 'title'),
            fireAt: stringField(body, 'fire_at'),
            timezone: stringField(body, 'timezone', 'UTC'),
            durationMinutes: optionalNumberField(body, 'duration_minutes'),
            idempotencyKey: stringField(body, 'idempotency_key'),
          },
        ),
      201,
    );
  }
  if (toolName === 'list_pending_shared_reminders') {
    return runCustomerTool(c, body, (customerId) =>
      listPendingSharedReminders(db as never, {
        inviteeAccountId: customerId,
      }),
    );
  }
  if (toolName === 'accept_shared_reminder') {
    return runCustomerTool(c, body, (customerId) =>
      acceptSharedReminder(
        db as never,
        { createRuntimeReminder, cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          requestId: stringField(body, 'request_id'),
          now: new Date(),
          idempotencyKey: stringField(body, 'idempotency_key'),
        },
      ),
    );
  }
  if (toolName === 'reject_shared_reminder') {
    return runCustomerTool(c, body, (customerId) =>
      rejectSharedReminder(
        db as never,
        { createRuntimeReminder, cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          requestId: stringField(body, 'request_id'),
          now: new Date(),
          idempotencyKey: stringField(body, 'idempotency_key'),
        },
      ),
    );
  }
  if (toolName === 'cancel_shared_reminder') {
    return runCustomerTool(c, body, (customerId) =>
      cancelSharedReminder(
        db as never,
        { createRuntimeReminder, cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          requestId: stringField(body, 'request_id'),
          now: new Date(),
          idempotencyKey: stringField(body, 'idempotency_key'),
        },
      ),
    );
  }
  return c.json({ ok: false, error: 'unknown_tool' }, 404);
});

internalSchedulingRouter.post('/notifications/retry', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readOptionalJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    const result = await deliverPendingProductNotifications(db as never, {
      limit: numberField(body, 'limit', 50),
    });
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: schedulingErrorCode(error) }, 400);
  }
});
