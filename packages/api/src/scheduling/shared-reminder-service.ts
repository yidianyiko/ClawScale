import type {
  CreateReminderInput,
  ReminderCommandInput,
  ReminderRuntimeRecord,
  ReminderRuntimeResult,
} from '../lib/reminder-runtime-client.js';
import type { SharedReminderProjectionRole, SharedReminderRequestStatus } from './types.js';

type SharedReminderActorRole = SharedReminderProjectionRole | 'system';

interface FriendshipRecord {
  id: string;
  accountAId: string;
  accountBId: string;
  status: 'active' | 'removed';
}

interface SharedReminderRequestRecord {
  id: string;
  requesterAccountId: string;
  inviteeAccountId: string;
  friendshipId?: string;
  title: string;
  fireAt: Date;
  timezone: string;
  status: SharedReminderRequestStatus;
  requesterReminderId?: string | null;
  inviteeReminderId?: string | null;
  resolvedAt?: Date | null;
  [key: string]: unknown;
}

interface SharedReminderActionResult {
  id: string;
  status: SharedReminderRequestStatus;
}

export interface ReminderRuntimePort {
  createRuntimeReminder(input: CreateReminderInput): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>>;
  cancelRuntimeReminder(input: ReminderCommandInput): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>>;
}

export interface SharedReminderClient {
  friendship: {
    findFirst(args: { where: Record<string, unknown> }): Promise<FriendshipRecord | null>;
  };
  sharedReminderRequest: {
    create(args: { data: Record<string, unknown> }): Promise<SharedReminderRequestRecord>;
    findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<SharedReminderRequestRecord | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> | Record<string, unknown>[] }): Promise<SharedReminderRequestRecord[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  sharedReminderEvent?: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  reminderProjection: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  productNotification: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
}

function nonEmpty(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(code);
  }
  return trimmed;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function splitInstant(fireAt: string | Date): { localDate: string; localTime: string } {
  const value = fireAt instanceof Date ? fireAt : new Date(fireAt);
  if (Number.isNaN(value.getTime())) {
    throw new Error('invalid_body');
  }
  return {
    localDate: value.toISOString().slice(0, 10),
    localTime: value.toISOString().slice(11, 16),
  };
}

function dueOrPast(request: SharedReminderRequestRecord, now: Date): boolean {
  return request.fireAt.getTime() <= now.getTime();
}

async function findActiveFriendship(
  client: Pick<SharedReminderClient, 'friendship'>,
  accountAId: string,
  accountBId: string,
): Promise<FriendshipRecord | null> {
  return client.friendship.findFirst({
    where: {
      status: 'active',
      OR: [
        { accountAId, accountBId },
        { accountAId: accountBId, accountBId: accountAId },
      ],
    },
  });
}

async function readSharedReminderRequest(
  client: Pick<SharedReminderClient, 'sharedReminderRequest'>,
  requestId: string,
): Promise<SharedReminderRequestRecord> {
  const request = await client.sharedReminderRequest.findFirst({ where: { id: requestId } });
  if (!request) {
    throw new Error('shared_reminder_not_found');
  }
  return request;
}

async function recordEvent(
  client: Pick<SharedReminderClient, 'sharedReminderEvent'>,
  input: {
    requestId: string;
    fromState: SharedReminderRequestStatus | null;
    toState: SharedReminderRequestStatus;
    actorAccountId: string | null;
    actorRole: SharedReminderActorRole;
    idempotencyKey: string;
    reason?: string;
  },
): Promise<void> {
  if (!client.sharedReminderEvent) {
    return;
  }
  try {
    await client.sharedReminderEvent.create({
      data: {
        sharedReminderRequestId: input.requestId,
        fromState: input.fromState,
        toState: input.toState,
        actorAccountId: input.actorAccountId,
        actorRole: input.actorRole,
        idempotencyKey: `shared-reminder:${input.requestId}:event:${input.idempotencyKey}`,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
  }
}

async function enqueueSharedReminderNotification(
  client: Pick<SharedReminderClient, 'productNotification'>,
  input: {
    requestId: string;
    recipientAccountId: string;
    kind: string;
    text: string;
    allowedActions: string[];
  },
): Promise<void> {
  try {
    await client.productNotification.create({
      data: {
        sharedReminderRequestId: input.requestId,
        recipientAccountId: input.recipientAccountId,
        idempotencyKey: `shared-reminder:${input.requestId}:${input.kind}`,
        kind: input.kind,
        payload: {
          text: input.text,
          metadata: {
            request_id: input.requestId,
            request_type: 'shared_reminder_request',
            allowed_actions: input.allowedActions,
          },
        },
        status: 'pending_delivery',
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
  }
}

async function createProjection(
  client: Pick<SharedReminderClient, 'reminderProjection'>,
  reminderRuntime: ReminderRuntimePort,
  input: {
    request: SharedReminderRequestRecord;
    ownerAccountId: string;
    title: string;
    timezone: string;
    fireAt: Date;
    role: SharedReminderProjectionRole;
    counterpartyAccountId: string;
  },
): Promise<string> {
  const when = splitInstant(input.fireAt);
  const projection = await reminderRuntime.createRuntimeReminder({
    customerId: input.ownerAccountId,
    title: input.title,
    localDate: when.localDate,
    localTime: when.localTime,
    timezone: input.timezone,
    metadata: {
      shared_reminder_request_id: input.request.id,
      projection_role: input.role,
      counterparty_account_id: input.counterpartyAccountId,
    },
  });
  if (!projection.ok) {
    throw new Error('reminder_projection_failed');
  }
  const runtimeReminderId = String(projection.data['id']);
  await client.reminderProjection.create({
    data: {
      sharedReminderRequestId: input.request.id,
      ownerAccountId: input.ownerAccountId,
      runtimeReminderId,
      role: input.role,
    },
  });
  return runtimeReminderId;
}

async function cancelProjection(
  reminderRuntime: ReminderRuntimePort,
  input: {
    customerId: string;
    reminderId?: string | null;
  },
): Promise<void> {
  if (!input.reminderId) {
    return;
  }
  const result = await reminderRuntime.cancelRuntimeReminder({
    customerId: input.customerId,
    reminderId: input.reminderId,
  });
  if (!result.ok) {
    throw new Error('reminder_projection_failed');
  }
}

function terminalRetryResult(
  request: SharedReminderRequestRecord,
  input: {
    actorAccountId: string;
    actorField: 'requesterAccountId' | 'inviteeAccountId';
    intendedStatus: SharedReminderRequestStatus;
  },
): SharedReminderActionResult {
  if (
    request[input.actorField] === input.actorAccountId &&
    request.status === input.intendedStatus
  ) {
    return { id: request.id, status: request.status };
  }
  throw new Error('shared_reminder_not_found');
}

async function expirePendingRequest(
  client: Pick<SharedReminderClient, 'sharedReminderRequest' | 'sharedReminderEvent'>,
  request: SharedReminderRequestRecord,
  idempotencyKey: string,
): Promise<void> {
  await client.sharedReminderRequest.updateMany({
    where: { id: request.id, status: 'pending_invitee_confirmation' },
    data: { status: 'expired', resolvedAt: expectableDate() },
  });
  await recordEvent(client, {
    requestId: request.id,
    fromState: 'pending_invitee_confirmation',
    toState: 'expired',
    actorAccountId: null,
    actorRole: 'system',
    idempotencyKey,
    reason: 'fire_time_reached',
  });
}

function expectableDate(): Date {
  return new Date();
}

export async function createSharedReminder(
  client: SharedReminderClient,
  reminderRuntime: ReminderRuntimePort,
  input: {
    requesterAccountId: string;
    inviteeAccountId: string;
    title: string;
    fireAt: string;
    timezone: string;
    idempotencyKey: string;
  },
): Promise<Record<string, unknown>> {
  const requesterAccountId = nonEmpty(input.requesterAccountId, 'invalid_account');
  const inviteeAccountId = nonEmpty(input.inviteeAccountId, 'invalid_account');
  const title = nonEmpty(input.title, 'invalid_body');
  const timezone = nonEmpty(input.timezone, 'invalid_body');
  const idempotencyKey = nonEmpty(input.idempotencyKey, 'invalid_body');
  const when = new Date(input.fireAt);
  if (Number.isNaN(when.getTime())) {
    throw new Error('invalid_body');
  }
  if (requesterAccountId === inviteeAccountId) {
    throw new Error('cannot_friend_self');
  }

  const friendship = await findActiveFriendship(client, requesterAccountId, inviteeAccountId);
  if (!friendship) {
    throw new Error('friendship_required');
  }
  const request = await client.sharedReminderRequest.create({
    data: {
      requesterAccountId,
      inviteeAccountId,
      friendshipId: friendship.id,
      title,
      fireAt: when,
      timezone,
      idempotencyKey,
      status: 'pending_invitee_confirmation',
    },
  });

  let runtimeReminderId: string;
  try {
    runtimeReminderId = await createProjection(client, reminderRuntime, {
      request,
      ownerAccountId: requesterAccountId,
      title,
      fireAt: when,
      timezone,
      role: 'requester',
      counterpartyAccountId: inviteeAccountId,
    });
  } catch (error) {
    await client.sharedReminderRequest.updateMany({
      where: { id: request.id },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    throw error;
  }

  await client.sharedReminderRequest.updateMany({
    where: { id: request.id, status: 'pending_invitee_confirmation' },
    data: { requesterReminderId: runtimeReminderId },
  });
  await recordEvent(client, {
    requestId: request.id,
    fromState: null,
    toState: 'pending_invitee_confirmation',
    actorAccountId: requesterAccountId,
    actorRole: 'requester',
    idempotencyKey,
  });
  await enqueueSharedReminderNotification(client, {
    requestId: request.id,
    recipientAccountId: inviteeAccountId,
    kind: 'shared_reminder_request',
    text: '你有一个共享提醒请求，请确认或拒绝。',
    allowedActions: ['accept', 'reject'],
  });
  return { ...request, requesterReminderId: runtimeReminderId };
}

export async function acceptSharedReminder(
  client: SharedReminderClient,
  reminderRuntime: ReminderRuntimePort,
  input: {
    actorAccountId: string;
    requestId: string;
    now: Date;
    idempotencyKey: string;
  },
): Promise<SharedReminderActionResult> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'shared_reminder_not_found');
  const idempotencyKey = nonEmpty(input.idempotencyKey, 'invalid_body');
  const request = await readSharedReminderRequest(client, requestId);
  if (request.inviteeAccountId !== actorAccountId) {
    throw new Error('shared_reminder_not_found');
  }
  if (request.status === 'accepted') {
    return { id: request.id, status: 'accepted' };
  }
  if (request.status !== 'pending_invitee_confirmation') {
    throw new Error('shared_reminder_not_pending');
  }
  if (dueOrPast(request, input.now)) {
    await expirePendingRequest(client, request, idempotencyKey);
    throw new Error('shared_reminder_due');
  }

  const inviteeReminderId = await createProjection(client, reminderRuntime, {
    request,
    ownerAccountId: actorAccountId,
    title: request.title,
    fireAt: request.fireAt,
    timezone: request.timezone,
    role: 'invitee',
    counterpartyAccountId: request.requesterAccountId,
  });
  const transition = await client.sharedReminderRequest.updateMany({
    where: { id: request.id, status: 'pending_invitee_confirmation', inviteeAccountId: actorAccountId },
    data: { status: 'accepted', inviteeReminderId, resolvedAt: new Date() },
  });
  if (transition.count !== 1) {
    const latest = await readSharedReminderRequest(client, request.id);
    return terminalRetryResult(latest, {
      actorAccountId,
      actorField: 'inviteeAccountId',
      intendedStatus: 'accepted',
    });
  }
  await recordEvent(client, {
    requestId: request.id,
    fromState: 'pending_invitee_confirmation',
    toState: 'accepted',
    actorAccountId,
    actorRole: 'invitee',
    idempotencyKey,
  });
  return { id: request.id, status: 'accepted' };
}

export async function rejectSharedReminder(
  client: SharedReminderClient,
  reminderRuntime: ReminderRuntimePort,
  input: {
    actorAccountId: string;
    requestId: string;
    now: Date;
    idempotencyKey: string;
  },
): Promise<SharedReminderActionResult> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'shared_reminder_not_found');
  const idempotencyKey = nonEmpty(input.idempotencyKey, 'invalid_body');
  const request = await readSharedReminderRequest(client, requestId);
  if (request.inviteeAccountId !== actorAccountId) {
    throw new Error('shared_reminder_not_found');
  }
  if (request.status === 'rejected') {
    return { id: request.id, status: 'rejected' };
  }
  if (request.status !== 'pending_invitee_confirmation') {
    throw new Error('shared_reminder_not_pending');
  }
  if (dueOrPast(request, input.now)) {
    await expirePendingRequest(client, request, idempotencyKey);
    throw new Error('shared_reminder_due');
  }

  const transition = await client.sharedReminderRequest.updateMany({
    where: { id: request.id, status: 'pending_invitee_confirmation', inviteeAccountId: actorAccountId },
    data: { status: 'rejected', resolvedAt: new Date() },
  });
  if (transition.count !== 1) {
    const latest = await readSharedReminderRequest(client, request.id);
    return terminalRetryResult(latest, {
      actorAccountId,
      actorField: 'inviteeAccountId',
      intendedStatus: 'rejected',
    });
  }
  await cancelProjection(reminderRuntime, {
    customerId: request.requesterAccountId,
    reminderId: request.requesterReminderId,
  });
  await recordEvent(client, {
    requestId: request.id,
    fromState: 'pending_invitee_confirmation',
    toState: 'rejected',
    actorAccountId,
    actorRole: 'invitee',
    idempotencyKey,
  });
  return { id: request.id, status: 'rejected' };
}

export async function cancelSharedReminder(
  client: SharedReminderClient,
  reminderRuntime: ReminderRuntimePort,
  input: {
    actorAccountId: string;
    requestId: string;
    now: Date;
    idempotencyKey: string;
  },
): Promise<SharedReminderActionResult> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'shared_reminder_not_found');
  const idempotencyKey = nonEmpty(input.idempotencyKey, 'invalid_body');
  const request = await readSharedReminderRequest(client, requestId);
  if (request.requesterAccountId !== actorAccountId) {
    throw new Error('shared_reminder_not_found');
  }
  if (request.status === 'cancelled') {
    return { id: request.id, status: 'cancelled' };
  }
  if (request.status !== 'pending_invitee_confirmation' && request.status !== 'accepted') {
    throw new Error('shared_reminder_not_pending');
  }
  if (dueOrPast(request, input.now)) {
    await expirePendingRequest(client, request, idempotencyKey);
    throw new Error('shared_reminder_due');
  }

  const transition = await client.sharedReminderRequest.updateMany({
    where: { id: request.id, status: request.status, requesterAccountId: actorAccountId },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  if (transition.count !== 1) {
    const latest = await readSharedReminderRequest(client, request.id);
    return terminalRetryResult(latest, {
      actorAccountId,
      actorField: 'requesterAccountId',
      intendedStatus: 'cancelled',
    });
  }
  await cancelProjection(reminderRuntime, {
    customerId: request.requesterAccountId,
    reminderId: request.requesterReminderId,
  });
  await cancelProjection(reminderRuntime, {
    customerId: request.inviteeAccountId,
    reminderId: request.inviteeReminderId,
  });
  await recordEvent(client, {
    requestId: request.id,
    fromState: request.status,
    toState: 'cancelled',
    actorAccountId,
    actorRole: 'requester',
    idempotencyKey,
  });
  return { id: request.id, status: 'cancelled' };
}

export async function expireDueSharedReminders(
  client: SharedReminderClient,
  input: { now: Date; limit?: number },
): Promise<{ count: number }> {
  const requests = await client.sharedReminderRequest.findMany({
    where: {
      status: 'pending_invitee_confirmation',
      fireAt: { lte: input.now },
    },
    orderBy: { fireAt: 'asc' },
  });
  const selected = input.limit ? requests.slice(0, input.limit) : requests;
  for (const request of selected) {
    await expirePendingRequest(client, request, `expire:${request.id}:${input.now.toISOString()}`);
  }
  return { count: selected.length };
}

export async function listPendingSharedReminders(
  client: SharedReminderClient,
  input: { inviteeAccountId: string },
): Promise<SharedReminderRequestRecord[]> {
  const inviteeAccountId = nonEmpty(input.inviteeAccountId, 'invalid_account');
  return client.sharedReminderRequest.findMany({
    where: {
      inviteeAccountId,
      status: 'pending_invitee_confirmation',
    },
    orderBy: { createdAt: 'desc' },
  });
}
