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
  cancelFriendRequest,
  listFriendRequests,
  listFriends,
  rejectFriendRequest,
  removeFriendship,
} from '../scheduling/friendship-service.js';
import {
  resolveActiveFriendForRead,
  resolveActiveFriendshipForMutation,
  resolvePendingRequestForAction,
  resolveSharedReminderInvitee,
} from '../scheduling/friend-target-resolver.js';
import { listFriendCalendarFacts } from '../scheduling/friend-calendar-facts-service.js';
import { deliverPendingProductNotifications } from '../scheduling/notification-service.js';
import {
  acceptSharedReminder,
  cancelSharedReminder,
  createSharedReminder,
  listPendingSharedReminders,
  listSharedReminders,
  rejectSharedReminder,
} from '../scheduling/shared-reminder-service.js';
import type { SharedReminderRequestStatus } from '../scheduling/types.js';
import {
  disableUserLink,
  getOrCreateActiveUserLink,
  resetUserLink,
  sendFriendRequestByUserLinkCode,
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

function optionalDateField(body: JsonRecord, key: string): string | null {
  const value = stringField(body, key).trim();
  if (!value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('invalid_body');
  }
  return value;
}

function validateOptionalDateRange(fromDate: string | null, toDate: string | null): void {
  if ((fromDate && !toDate) || (!fromDate && toDate)) {
    throw new Error('invalid_body');
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw new Error('invalid_body');
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function requestFriendName(body: JsonRecord): string {
  return (
    stringField(body, 'friend_name').trim() ||
      stringField(body, 'requester_name').trim() ||
      stringField(body, 'target_name').trim()
  );
}

function calendarFactsFriendName(body: JsonRecord): string {
  return (
    stringField(body, 'friend_name').trim() ||
      stringField(body, 'target_name').trim() ||
      stringField(body, 'name').trim()
  );
}

function friendResolverClient() {
  return {
    listFriendRequests: (accountId: string) => listFriendRequests(db as never, { accountId }),
    listFriends: (accountId: string) => listFriends(db as never, { accountId }),
  };
}

async function resolvedPendingRequestId(
  body: JsonRecord,
  actorAccountId: string,
  actorRole: 'requester' | 'target',
): Promise<string> {
  const result = await resolvePendingRequestForAction(friendResolverClient(), {
    actorRole,
    actorAccountId,
    requestId: stringField(body, 'request_id'),
    friendName: requestFriendName(body),
  });
  return result.requestId;
}

async function resolvedFriendshipId(body: JsonRecord, actorAccountId: string): Promise<string> {
  const result = await resolveActiveFriendshipForMutation(friendResolverClient(), {
    actorAccountId,
    friendshipId: stringField(body, 'friendship_id'),
    friendName: requestFriendName(body),
  });
  return result.friendshipId;
}

async function resolvedFriendAccountIdForLookup(
  body: JsonRecord,
  actorAccountId: string,
): Promise<string> {
  const result = await resolveActiveFriendForRead(friendResolverClient(), {
    actorAccountId,
    targetAccountId: stringField(body, 'target_account_id'),
    friendName: calendarFactsFriendName(body),
  });
  return result.otherAccountId;
}

async function resolvedInviteeAccountId(body: JsonRecord, requesterAccountId: string): Promise<string> {
  const result = await resolveSharedReminderInvitee(friendResolverClient(), {
    actorAccountId: requesterAccountId,
    inviteeAccountId: stringField(body, 'invitee_account_id'),
    friendName: stringField(body, 'invitee_name'),
  });
  return result.otherAccountId;
}

type SharedReminderLookupRecord = {
  id: string;
  requesterAccountId: string;
  inviteeAccountId: string;
  status: string;
  requester?: { displayName?: string | null } | null;
  invitee?: { displayName?: string | null } | null;
};

function sharedReminderProfileName(
  record: SharedReminderLookupRecord,
  actorField: 'requesterAccountId' | 'inviteeAccountId',
): string {
  const profile = actorField === 'requesterAccountId' ? record.invitee : record.requester;
  return normalizeName(profile?.displayName ?? '');
}

async function resolveSharedReminderRequestId(
  body: JsonRecord,
  actorAccountId: string,
  toolName: 'accept_shared_reminder' | 'reject_shared_reminder' | 'cancel_shared_reminder',
): Promise<string> {
  const explicit = stringField(body, 'request_id').trim();
  if (explicit) {
    return explicit;
  }

  // For accept / reject the actor is the invitee; for cancel the actor is the requester.
  const actorField = toolName === 'cancel_shared_reminder' ? 'requesterAccountId' : 'inviteeAccountId';
  const counterpartyName = (
    stringField(body, 'inviter_name') ||
      stringField(body, 'requester_name') ||
      stringField(body, 'invitee_name') ||
      stringField(body, 'friend_name')
  ).trim().toLowerCase();

  const records = (await (db as never as {
    sharedReminderRequest: {
      findMany: (args: unknown) => Promise<SharedReminderLookupRecord[]>;
    };
  }).sharedReminderRequest.findMany({
    where: {
      status: 'pending_invitee_confirmation',
      [actorField]: actorAccountId,
    },
    include: {
      requester: { select: { displayName: true } },
      invitee: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })) as SharedReminderLookupRecord[];

  const candidates = counterpartyName
    ? records.filter((record) => {
        const displayName = sharedReminderProfileName(record, actorField);
        return displayName === counterpartyName || displayName.includes(counterpartyName);
      })
    : records;

  if (candidates.length === 0) {
    throw new Error(counterpartyName ? 'shared_reminder_name_not_found' : 'shared_reminder_request_not_found');
  }
  if (candidates.length > 1) {
    throw new Error('shared_reminder_request_ambiguous');
  }
  return candidates[0]?.id ?? '';
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
  if (toolName === 'send_friend_request_by_user_link_code') {
    return runCustomerTool(c, body, (customerId) =>
      sendFriendRequestByUserLinkCode(db as never, {
        requesterAccountId: customerId,
        code: stringField(body, 'user_link_code'),
        message: stringField(body, 'message') || null,
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'accept_friend_request') {
    return runCustomerTool(c, body, async (customerId) =>
      acceptFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: await resolvedPendingRequestId(body, customerId, 'target'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'reject_friend_request') {
    return runCustomerTool(c, body, async (customerId) =>
      rejectFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: await resolvedPendingRequestId(body, customerId, 'target'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'cancel_friend_request') {
    return runCustomerTool(c, body, async (customerId) =>
      cancelFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: await resolvedPendingRequestId(body, customerId, 'requester'),
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
    return runCustomerTool(c, body, async (customerId) =>
      removeFriendship(
        db as never,
        { cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          friendshipId: await resolvedFriendshipId(body, customerId),
        },
      ),
    );
  }
  if (toolName === 'list_friend_calendar_facts') {
    return runCustomerTool(c, body, async (customerId) =>
      listFriendCalendarFacts(
        db as never,
        { listRuntimeCalendarFacts },
        {
          requesterAccountId: customerId,
          targetAccountId: await resolvedFriendAccountIdForLookup(body, customerId),
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
      async (customerId) => {
        const timezone = stringField(body, 'timezone').trim();
        if (!timezone) {
          throw new Error('invalid_body');
        }
        return createSharedReminder(
          db as never,
          { createRuntimeReminder, cancelRuntimeReminder },
          {
            requesterAccountId: customerId,
            inviteeAccountId: await resolvedInviteeAccountId(body, customerId),
            title: stringField(body, 'title'),
            fireAt: stringField(body, 'fire_at'),
            timezone,
            durationMinutes: optionalNumberField(body, 'duration_minutes'),
            idempotencyKey: stringField(body, 'idempotency_key'),
          },
        );
      },
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
  if (toolName === 'list_shared_reminders') {
    return runCustomerTool(c, body, async (customerId) => {
      const status = stringField(body, 'status').trim() || null;
      const fromDate = optionalDateField(body, 'from_date');
      const toDate = optionalDateField(body, 'to_date');
      validateOptionalDateRange(fromDate, toDate);
      const timezone = stringField(body, 'timezone').trim();
      if (fromDate && toDate && !timezone) {
        throw new Error('invalid_body');
      }
      const hasFriendFilter = Boolean(
        stringField(body, 'target_account_id').trim() || calendarFactsFriendName(body),
      );
      const friendAccountId = hasFriendFilter
        ? await resolvedFriendAccountIdForLookup(body, customerId)
        : null;
      const query = {
        accountId: customerId,
        friendAccountId,
        status: status as SharedReminderRequestStatus | null,
        ...(timezone ? { timezone } : {}),
        ...(fromDate && toDate ? { fromDate, toDate } : {}),
      };
      const sharedReminders = await listSharedReminders(db as never, {
        ...query,
      });
      const response: JsonRecord = {
        friend_name: calendarFactsFriendName(body) || null,
        status,
        shared_reminders: sharedReminders,
      };
      if (!hasFriendFilter || (fromDate && toDate)) {
        response['from_date'] = fromDate;
        response['to_date'] = toDate;
        if (timezone) {
          response['timezone'] = timezone;
        }
      }
      return response;
    });
  }
  if (toolName === 'accept_shared_reminder') {
    return runCustomerTool(c, body, async (customerId) => {
      const requestId = await resolveSharedReminderRequestId(body, customerId, 'accept_shared_reminder');
      return acceptSharedReminder(
        db as never,
        { createRuntimeReminder, cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          requestId,
          now: new Date(),
          idempotencyKey: stringField(body, 'idempotency_key'),
        },
      );
    });
  }
  if (toolName === 'reject_shared_reminder') {
    return runCustomerTool(c, body, async (customerId) => {
      const requestId = await resolveSharedReminderRequestId(body, customerId, 'reject_shared_reminder');
      return rejectSharedReminder(
        db as never,
        { createRuntimeReminder, cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          requestId,
          now: new Date(),
          idempotencyKey: stringField(body, 'idempotency_key'),
        },
      );
    });
  }
  if (toolName === 'cancel_shared_reminder') {
    return runCustomerTool(c, body, async (customerId) => {
      const requestId = await resolveSharedReminderRequestId(body, customerId, 'cancel_shared_reminder');
      return cancelSharedReminder(
        db as never,
        { createRuntimeReminder, cancelRuntimeReminder },
        {
          actorAccountId: customerId,
          requestId,
          now: new Date(),
          idempotencyKey: stringField(body, 'idempotency_key'),
        },
      );
    });
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
