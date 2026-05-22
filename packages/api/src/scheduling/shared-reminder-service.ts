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

interface PendingClaim {
  request: SharedReminderRequestRecord;
  claimedAt: Date;
}

interface ReminderProjectionRecord {
  id: string;
  sharedReminderRequestId: string;
  ownerAccountId: string;
  runtimeReminderId: string;
  role: SharedReminderProjectionRole;
  [key: string]: unknown;
}

interface ProjectionCreationResult {
  runtimeReminderId: string;
  created: boolean;
  ownerAccountId: string;
  role: SharedReminderProjectionRole;
}

const STALE_PENDING_CLAIM_MS = 5 * 60 * 1000;

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
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
    findFirst(args: { where: Record<string, unknown> }): Promise<ReminderProjectionRecord | null>;
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

function splitInstant(fireAt: string | Date, timezone: string): { localDate: string; localTime: string } {
  const value = fireAt instanceof Date ? fireAt : new Date(fireAt);
  if (Number.isNaN(value.getTime())) {
    throw new Error('invalid_body');
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
  } catch {
    throw new Error('invalid_body');
  }
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get('year');
  const month = byType.get('month');
  const day = byType.get('day');
  const hour = byType.get('hour');
  const minute = byType.get('minute');
  if (!year || !month || !day || !hour || !minute) {
    throw new Error('invalid_body');
  }
  return {
    localDate: `${year}-${month}-${day}`,
    localTime: `${hour}:${minute}`,
  };
}

function requireRuntimeReminderId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  throw new Error('reminder_projection_failed');
}

function dueOrPast(request: SharedReminderRequestRecord, now: Date): boolean {
  return request.fireAt.getTime() <= now.getTime();
}

function unclaimedOrStaleClaimWhere(now: Date): Record<string, unknown> {
  return {
    OR: [
      { resolvedAt: null },
      { resolvedAt: { lt: new Date(now.getTime() - STALE_PENDING_CLAIM_MS) } },
    ],
  };
}

function claimWhere(input: {
  requestId: string;
  actorField: 'requesterAccountId' | 'inviteeAccountId';
  actorAccountId: string;
  now: Date;
}): Record<string, unknown> {
  return {
    id: input.requestId,
    status: 'pending_invitee_confirmation',
    [input.actorField]: input.actorAccountId,
    ...unclaimedOrStaleClaimWhere(input.now),
  };
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

async function findIdempotentSharedReminderRequest(
  client: Pick<SharedReminderClient, 'sharedReminderRequest'>,
  input: {
    requesterAccountId: string;
    inviteeAccountId: string;
    idempotencyKey: string;
  },
): Promise<SharedReminderRequestRecord | null> {
  return client.sharedReminderRequest.findFirst({
    where: {
      requesterAccountId: input.requesterAccountId,
      inviteeAccountId: input.inviteeAccountId,
      idempotencyKey: input.idempotencyKey,
    },
  });
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

async function findProjection(
  client: Pick<SharedReminderClient, 'reminderProjection'>,
  input: {
    requestId: string;
    role: SharedReminderProjectionRole;
  },
): Promise<ReminderProjectionRecord | null> {
  return client.reminderProjection.findFirst({
    where: {
      sharedReminderRequestId: input.requestId,
      role: input.role,
    },
  });
}

async function reconcileRequesterReminderId(
  client: Pick<SharedReminderClient, 'sharedReminderRequest' | 'reminderProjection'>,
  request: SharedReminderRequestRecord,
): Promise<SharedReminderRequestRecord> {
  if (request.status !== 'pending_invitee_confirmation' || request.requesterReminderId) {
    return request;
  }
  const projection = await findProjection(client, {
    requestId: request.id,
    role: 'requester',
  });
  if (!projection) {
    return request;
  }
  const runtimeReminderId = projection.runtimeReminderId;
  const transition = await client.sharedReminderRequest.updateMany({
    where: {
      id: request.id,
      status: 'pending_invitee_confirmation',
      requesterReminderId: null,
    },
    data: { requesterReminderId: runtimeReminderId },
  });
  if (transition.count === 1) {
    return { ...request, requesterReminderId: runtimeReminderId };
  }
  const latest = await readSharedReminderRequest(client, request.id);
  if (latest.status !== 'pending_invitee_confirmation') {
    return latest;
  }
  if (latest.requesterReminderId) {
    return latest;
  }
  throw new Error('shared_reminder_not_found');
}

async function invalidateRequestForMissingFriendship(
  client: Pick<SharedReminderClient, 'sharedReminderRequest'>,
  request: SharedReminderRequestRecord,
): Promise<never> {
  await client.sharedReminderRequest.updateMany({
    where: { id: request.id, status: 'pending_invitee_confirmation' },
    data: { status: 'invalidated', resolvedAt: new Date() },
  });
  throw new Error('friendship_required');
}

async function ensureRequestFriendshipStillActive(
  client: Pick<SharedReminderClient, 'friendship' | 'sharedReminderRequest'>,
  request: SharedReminderRequestRecord,
): Promise<void> {
  const friendship = await findActiveFriendship(
    client,
    request.requesterAccountId,
    request.inviteeAccountId,
  );
  if (!friendship || friendship.id !== request.friendshipId) {
    await invalidateRequestForMissingFriendship(client, request);
  }
}

async function finalizeRequesterProjection(
  client: SharedReminderClient,
  reminderRuntime: ReminderRuntimePort,
  input: {
    request: SharedReminderRequestRecord;
    projection: ProjectionCreationResult;
    idempotencyKey: string;
  },
): Promise<Record<string, unknown>> {
  const transition = await client.sharedReminderRequest.updateMany({
    where: { id: input.request.id, status: 'pending_invitee_confirmation' },
    data: { requesterReminderId: input.projection.runtimeReminderId },
  });
  if (transition.count !== 1) {
    if (input.projection.created) {
      await cleanupCreatedProjection(client, reminderRuntime, {
        requestId: input.request.id,
        ownerAccountId: input.projection.ownerAccountId,
        runtimeReminderId: input.projection.runtimeReminderId,
        role: input.projection.role,
      });
    }
    throw new Error('shared_reminder_not_found');
  }
  await recordEvent(client, {
    requestId: input.request.id,
    fromState: null,
    toState: 'pending_invitee_confirmation',
    actorAccountId: input.request.requesterAccountId,
    actorRole: 'requester',
    idempotencyKey: input.idempotencyKey,
  });
  await enqueueSharedReminderNotification(client, {
    requestId: input.request.id,
    recipientAccountId: input.request.inviteeAccountId,
    kind: 'shared_reminder_request',
    text: '你有一个共享提醒请求，请确认或拒绝。',
    allowedActions: ['accept', 'reject'],
  });
  return { ...input.request, requesterReminderId: input.projection.runtimeReminderId };
}

async function reconcileOrResumeRequesterProjection(
  client: SharedReminderClient,
  reminderRuntime: ReminderRuntimePort,
  request: SharedReminderRequestRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const reconciled = await reconcileRequesterReminderId(client, request);
  if (
    reconciled.requesterReminderId ||
    reconciled.status !== 'pending_invitee_confirmation'
  ) {
    return reconciled;
  }
  await ensureRequestFriendshipStillActive(client, request);
  const projection = await createProjection(client, reminderRuntime, {
    request,
    ownerAccountId: request.requesterAccountId,
    title: request.title,
    fireAt: request.fireAt,
    timezone: request.timezone,
    role: 'requester',
    counterpartyAccountId: request.inviteeAccountId,
  });
  return finalizeRequesterProjection(client, reminderRuntime, {
    request,
    projection,
    idempotencyKey,
  });
}

async function resolveRequesterReminderId(
  client: Pick<SharedReminderClient, 'reminderProjection'>,
  request: SharedReminderRequestRecord,
): Promise<string | null | undefined> {
  if (request.requesterReminderId) {
    return request.requesterReminderId;
  }
  const projection = await findProjection(client, {
    requestId: request.id,
    role: 'requester',
  });
  return projection?.runtimeReminderId;
}

async function reconcileInviteeProjectionAsAccepted(
  client: Pick<SharedReminderClient, 'sharedReminderRequest' | 'sharedReminderEvent' | 'reminderProjection'>,
  request: SharedReminderRequestRecord,
  idempotencyKey: string,
  resolvedAt: Date,
): Promise<SharedReminderActionResult | null> {
  const projection = await findProjection(client, {
    requestId: request.id,
    role: 'invitee',
  });
  if (!projection) {
    return null;
  }
  const transition = await client.sharedReminderRequest.updateMany({
    where: { id: request.id, status: 'pending_invitee_confirmation' },
    data: {
      status: 'accepted',
      inviteeReminderId: projection.runtimeReminderId,
      resolvedAt,
    },
  });
  if (transition.count === 1) {
    await recordEvent(client, {
      requestId: request.id,
      fromState: 'pending_invitee_confirmation',
      toState: 'accepted',
      actorAccountId: request.inviteeAccountId,
      actorRole: 'invitee',
      idempotencyKey,
      reason: 'invitee_projection_reconciled',
    });
    return { id: request.id, status: 'accepted' };
  }
  const latest = await readSharedReminderRequest(client, request.id);
  if (latest.status === 'accepted') {
    return { id: latest.id, status: 'accepted' };
  }
  throw new Error('shared_reminder_not_found');
}

async function cleanupCreatedProjection(
  client: Pick<SharedReminderClient, 'reminderProjection'>,
  reminderRuntime: ReminderRuntimePort,
  input: {
    requestId: string;
    ownerAccountId: string;
    runtimeReminderId: string;
    role: SharedReminderProjectionRole;
  },
): Promise<void> {
  await cancelProjection(reminderRuntime, {
    customerId: input.ownerAccountId,
    reminderId: input.runtimeReminderId,
  });
  await client.reminderProjection.deleteMany({
    where: {
      sharedReminderRequestId: input.requestId,
      role: input.role,
      runtimeReminderId: input.runtimeReminderId,
    },
  });
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
): Promise<ProjectionCreationResult> {
  const when = splitInstant(input.fireAt, input.timezone);
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
  const runtimeReminderId = requireRuntimeReminderId(projection.data['id']);
  try {
    await client.reminderProjection.create({
      data: {
        sharedReminderRequestId: input.request.id,
        ownerAccountId: input.ownerAccountId,
        runtimeReminderId,
        role: input.role,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await findProjection(client, {
        requestId: input.request.id,
        role: input.role,
      });
      if (existing) {
        await cancelProjection(reminderRuntime, {
          customerId: input.ownerAccountId,
          reminderId: runtimeReminderId,
        });
        return {
          runtimeReminderId: existing.runtimeReminderId,
          created: false,
          ownerAccountId: input.ownerAccountId,
          role: input.role,
        };
      }
    }
    try {
      await cancelProjection(reminderRuntime, {
        customerId: input.ownerAccountId,
        reminderId: runtimeReminderId,
      });
    } catch {
      // Best-effort cleanup only; the persistence failure remains the cause.
    }
    throw new Error('reminder_projection_failed');
  }
  return {
    runtimeReminderId,
    created: true,
    ownerAccountId: input.ownerAccountId,
    role: input.role,
  };
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
    if (result.error === 'invalid_reminder') {
      return;
    }
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

async function claimPendingRequest(
  client: Pick<SharedReminderClient, 'sharedReminderRequest'>,
  request: SharedReminderRequestRecord,
  input: {
    actorField: 'requesterAccountId' | 'inviteeAccountId';
    actorAccountId: string;
    intendedStatus: SharedReminderRequestStatus;
    now: Date;
  },
): Promise<PendingClaim | SharedReminderActionResult> {
  const claimedAt = input.now;
  const transition = await client.sharedReminderRequest.updateMany({
    where: claimWhere({
      requestId: request.id,
      actorField: input.actorField,
      actorAccountId: input.actorAccountId,
      now: input.now,
    }),
    data: { resolvedAt: claimedAt },
  });
  if (transition.count !== 1) {
    const latest = await readSharedReminderRequest(client, request.id);
    return terminalRetryResult(latest, {
      actorAccountId: input.actorAccountId,
      actorField: input.actorField,
      intendedStatus: input.intendedStatus,
    });
  }
  return { request, claimedAt };
}

async function rollbackPendingClaim(
  client: Pick<SharedReminderClient, 'sharedReminderRequest'>,
  claim: PendingClaim,
  actorField: 'requesterAccountId' | 'inviteeAccountId',
  actorAccountId: string,
): Promise<void> {
  await client.sharedReminderRequest.updateMany({
    where: {
      id: claim.request.id,
      status: 'pending_invitee_confirmation',
      [actorField]: actorAccountId,
      resolvedAt: claim.claimedAt,
    },
    data: { resolvedAt: null },
  });
}

async function expirePendingRequest(
  client: Pick<SharedReminderClient, 'sharedReminderRequest' | 'sharedReminderEvent'>,
  request: SharedReminderRequestRecord,
  idempotencyKey: string,
  now: Date,
): Promise<void> {
  const transition = await client.sharedReminderRequest.updateMany({
    where: {
      id: request.id,
      status: 'pending_invitee_confirmation',
      ...unclaimedOrStaleClaimWhere(now),
    },
    data: { status: 'expired', resolvedAt: now },
  });
  if (transition.count !== 1) {
    return;
  }
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
  splitInstant(when, timezone);
  if (requesterAccountId === inviteeAccountId) {
    throw new Error('cannot_friend_self');
  }

  const friendship = await findActiveFriendship(client, requesterAccountId, inviteeAccountId);
  if (!friendship) {
    throw new Error('friendship_required');
  }
  let request: SharedReminderRequestRecord;
  try {
    request = await client.sharedReminderRequest.create({
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
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    const existing = await findIdempotentSharedReminderRequest(client, {
      requesterAccountId,
      inviteeAccountId,
      idempotencyKey,
    });
    if (!existing) {
      throw error;
    }
    return reconcileOrResumeRequesterProjection(client, reminderRuntime, existing, idempotencyKey);
  }

  await ensureRequestFriendshipStillActive(client, request);
  let projection: ProjectionCreationResult;
  try {
    projection = await createProjection(client, reminderRuntime, {
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

  return finalizeRequesterProjection(client, reminderRuntime, {
    request,
    projection,
    idempotencyKey,
  });
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
  const existingInviteeProjection = await findProjection(client, {
    requestId: request.id,
    role: 'invitee',
  });
  if (!existingInviteeProjection && dueOrPast(request, input.now)) {
    await expirePendingRequest(client, request, idempotencyKey, input.now);
    throw new Error('shared_reminder_due');
  }

  const claim = await claimPendingRequest(client, request, {
    actorAccountId,
    actorField: 'inviteeAccountId',
    intendedStatus: 'accepted',
    now: input.now,
  });
  if (!('claimedAt' in claim)) {
    return claim;
  }
  await ensureRequestFriendshipStillActive(client, request);
  let inviteeProjection: ProjectionCreationResult;
  try {
    inviteeProjection = existingInviteeProjection
      ? {
          runtimeReminderId: existingInviteeProjection.runtimeReminderId,
          created: false,
          ownerAccountId: actorAccountId,
          role: 'invitee',
        }
      : await createProjection(client, reminderRuntime, {
          request,
          ownerAccountId: actorAccountId,
          title: request.title,
          fireAt: request.fireAt,
          timezone: request.timezone,
          role: 'invitee',
          counterpartyAccountId: request.requesterAccountId,
        });
  } catch (error) {
    await rollbackPendingClaim(client, claim, 'inviteeAccountId', actorAccountId);
    throw error;
  }
  const finalize = await client.sharedReminderRequest.updateMany({
    where: {
      id: request.id,
      status: 'pending_invitee_confirmation',
      inviteeAccountId: actorAccountId,
      resolvedAt: claim.claimedAt,
    },
    data: { status: 'accepted', inviteeReminderId: inviteeProjection.runtimeReminderId },
  });
  if (finalize.count !== 1) {
    const latest = await readSharedReminderRequest(client, request.id);
    if (latest.status === 'accepted') {
      return { id: latest.id, status: 'accepted' };
    }
    if (inviteeProjection.created) {
      await cleanupCreatedProjection(client, reminderRuntime, {
        requestId: request.id,
        ownerAccountId: inviteeProjection.ownerAccountId,
        runtimeReminderId: inviteeProjection.runtimeReminderId,
        role: inviteeProjection.role,
      });
    }
    await rollbackPendingClaim(client, claim, 'inviteeAccountId', actorAccountId);
    throw new Error('shared_reminder_not_found');
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
  const reconciledAccepted = await reconcileInviteeProjectionAsAccepted(
    client,
    request,
    idempotencyKey,
    input.now,
  );
  if (reconciledAccepted) {
    return reconciledAccepted;
  }
  if (dueOrPast(request, input.now)) {
    await expirePendingRequest(client, request, idempotencyKey, input.now);
    throw new Error('shared_reminder_due');
  }

  const claim = await claimPendingRequest(client, request, {
    actorAccountId,
    actorField: 'inviteeAccountId',
    intendedStatus: 'rejected',
    now: input.now,
  });
  if (!('claimedAt' in claim)) {
    return claim;
  }
  await ensureRequestFriendshipStillActive(client, request);
  try {
    const requesterReminderId = await resolveRequesterReminderId(client, request);
    await cancelProjection(reminderRuntime, {
      customerId: request.requesterAccountId,
      reminderId: requesterReminderId,
    });
  } catch (error) {
    await rollbackPendingClaim(client, claim, 'inviteeAccountId', actorAccountId);
    throw error;
  }
  const transition = await client.sharedReminderRequest.updateMany({
    where: {
      id: request.id,
      status: 'pending_invitee_confirmation',
      inviteeAccountId: actorAccountId,
      resolvedAt: claim.claimedAt,
    },
    data: { status: 'rejected' },
  });
  if (transition.count !== 1) {
    throw new Error('shared_reminder_not_found');
  }
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
  if (request.status !== 'pending_invitee_confirmation') {
    throw new Error('shared_reminder_not_pending');
  }
  const reconciledAccepted = await reconcileInviteeProjectionAsAccepted(
    client,
    request,
    idempotencyKey,
    input.now,
  );
  if (reconciledAccepted) {
    return reconciledAccepted;
  }
  if (dueOrPast(request, input.now)) {
    await expirePendingRequest(client, request, idempotencyKey, input.now);
    throw new Error('shared_reminder_due');
  }

  const claim = await claimPendingRequest(client, request, {
    actorAccountId,
    actorField: 'requesterAccountId',
    intendedStatus: 'cancelled',
    now: input.now,
  });
  if (!('claimedAt' in claim)) {
    return claim;
  }
  await ensureRequestFriendshipStillActive(client, request);
  try {
    const requesterReminderId = await resolveRequesterReminderId(client, request);
    await cancelProjection(reminderRuntime, {
      customerId: request.requesterAccountId,
      reminderId: requesterReminderId,
    });
  } catch (error) {
    await rollbackPendingClaim(client, claim, 'requesterAccountId', actorAccountId);
    throw error;
  }
  const transition = await client.sharedReminderRequest.updateMany({
    where: {
      id: request.id,
      status: 'pending_invitee_confirmation',
      requesterAccountId: actorAccountId,
      resolvedAt: claim.claimedAt,
    },
    data: { status: 'cancelled' },
  });
  if (transition.count !== 1) {
    throw new Error('shared_reminder_not_found');
  }
  await recordEvent(client, {
    requestId: request.id,
    fromState: 'pending_invitee_confirmation',
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
      ...unclaimedOrStaleClaimWhere(input.now),
    },
    orderBy: { fireAt: 'asc' },
  });
  const selected = input.limit ? requests.slice(0, input.limit) : requests;
  let count = 0;
  for (const request of selected) {
    const inviteeProjection = await findProjection(client, {
      requestId: request.id,
      role: 'invitee',
    });
    if (inviteeProjection) {
      const transition = await client.sharedReminderRequest.updateMany({
        where: {
          id: request.id,
          status: 'pending_invitee_confirmation',
          ...unclaimedOrStaleClaimWhere(input.now),
        },
        data: {
          status: 'accepted',
          inviteeReminderId: inviteeProjection.runtimeReminderId,
          resolvedAt: input.now,
        },
      });
      if (transition.count === 1) {
        count += 1;
        await recordEvent(client, {
          requestId: request.id,
          fromState: 'pending_invitee_confirmation',
          toState: 'accepted',
          actorAccountId: request.inviteeAccountId,
          actorRole: 'invitee',
          idempotencyKey: `expire-reconcile:${request.id}:${input.now.toISOString()}`,
          reason: 'invitee_projection_reconciled',
        });
      }
      continue;
    }

    const transition = await client.sharedReminderRequest.updateMany({
      where: {
        id: request.id,
        status: 'pending_invitee_confirmation',
        ...unclaimedOrStaleClaimWhere(input.now),
      },
      data: { status: 'expired', resolvedAt: input.now },
    });
    if (transition.count === 1) {
      count += 1;
      await recordEvent(client, {
        requestId: request.id,
        fromState: 'pending_invitee_confirmation',
        toState: 'expired',
        actorAccountId: null,
        actorRole: 'system',
        idempotencyKey: `expire:${request.id}:${input.now.toISOString()}`,
        reason: 'fire_time_reached',
      });
    }
  }
  return { count };
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
