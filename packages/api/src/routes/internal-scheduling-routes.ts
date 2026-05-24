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
  type FriendshipRecord,
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

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function requestFriendName(body: JsonRecord): string {
  return normalizeName(
    stringField(body, 'friend_name') ||
      stringField(body, 'requester_name') ||
      stringField(body, 'target_name'),
  );
}

function accountIdForFriend(friendship: FriendshipRecord, actorAccountId: string): string | null {
  if (friendship.accountAId === actorAccountId) return friendship.accountBId;
  if (friendship.accountBId === actorAccountId) return friendship.accountAId;
  return null;
}

function displayNameForFriend(friendship: FriendshipRecord, actorAccountId: string): string {
  const friendProfile =
    friendship.accountAId === actorAccountId
      ? friendship.accountB
      : friendship.accountBId === actorAccountId
        ? friendship.accountA
        : null;
  return friendProfile?.displayName ?? '';
}

async function resolveInviteeAccountId(body: JsonRecord, requesterAccountId: string): Promise<string> {
  const explicitInviteeAccountId = stringField(body, 'invitee_account_id').trim();
  if (explicitInviteeAccountId) {
    return explicitInviteeAccountId;
  }
  const inviteeName = normalizeName(stringField(body, 'invitee_name'));
  if (!inviteeName) {
    return '';
  }

  const friends = await listFriends(db as never, { accountId: requesterAccountId });
  const matches = friends.filter((friendship) => {
    const displayName = normalizeName(displayNameForFriend(friendship, requesterAccountId));
    return displayName === inviteeName || displayName.includes(inviteeName);
  });
  if (matches.length === 0) {
    throw new Error('friend_not_found');
  }
  if (matches.length > 1) {
    throw new Error('friend_name_ambiguous');
  }
  const matchedFriendship = matches[0];
  if (!matchedFriendship) {
    throw new Error('friend_not_found');
  }
  return accountIdForFriend(matchedFriendship, requesterAccountId) ?? '';
}

type FriendRequestLookupRecord = {
  id: string;
  requesterAccountId: string;
  targetAccountId: string;
  status: string;
  requester?: { displayName?: string | null } | null;
  target?: { displayName?: string | null } | null;
};

function friendRequestProfileName(
  request: FriendRequestLookupRecord,
  actorField: 'requesterAccountId' | 'targetAccountId',
): string {
  const profile = actorField === 'requesterAccountId' ? request.target : request.requester;
  return normalizeName(profile?.displayName ?? '');
}

async function resolveFriendRequestId(
  body: JsonRecord,
  actorAccountId: string,
  toolName: 'accept_friend_request' | 'reject_friend_request' | 'cancel_friend_request',
): Promise<string> {
  const explicitRequestId = stringField(body, 'request_id').trim();
  if (explicitRequestId) {
    return explicitRequestId;
  }

  const friendName = requestFriendName(body);
  if (!friendName) {
    return '';
  }

  const actorField = toolName === 'cancel_friend_request' ? 'requesterAccountId' : 'targetAccountId';
  const requests = (await listFriendRequests(db as never, {
    accountId: actorAccountId,
  })) as FriendRequestLookupRecord[];
  const matches = requests.filter((request) => {
    if (request.status !== 'pending') {
      return false;
    }
    if (request[actorField] !== actorAccountId) {
      return false;
    }
    const displayName = friendRequestProfileName(request, actorField);
    return displayName === friendName || displayName.includes(friendName);
  });

  if (matches.length === 0) {
    throw new Error('friend_name_not_found');
  }
  if (matches.length > 1) {
    throw new Error('friend_name_ambiguous');
  }
  return matches[0]?.id ?? '';
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
  const counterpartyName = normalizeName(
    stringField(body, 'inviter_name') ||
      stringField(body, 'requester_name') ||
      stringField(body, 'invitee_name') ||
      stringField(body, 'friend_name'),
  );

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
        requestId: await resolveFriendRequestId(body, customerId, 'accept_friend_request'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'reject_friend_request') {
    return runCustomerTool(c, body, async (customerId) =>
      rejectFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: await resolveFriendRequestId(body, customerId, 'reject_friend_request'),
        idempotencyKey: stringField(body, 'idempotency_key'),
      }),
    );
  }
  if (toolName === 'cancel_friend_request') {
    return runCustomerTool(c, body, async (customerId) =>
      cancelFriendRequest(db as never, {
        actorAccountId: customerId,
        requestId: await resolveFriendRequestId(body, customerId, 'cancel_friend_request'),
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
      async (customerId) =>
        createSharedReminder(
          db as never,
          { createRuntimeReminder, cancelRuntimeReminder },
          {
            requesterAccountId: customerId,
            inviteeAccountId: await resolveInviteeAccountId(body, customerId),
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
