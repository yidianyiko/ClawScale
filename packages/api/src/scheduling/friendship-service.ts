import { enqueueProductNotification } from './notification-service.js';

type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
type FriendshipStatus = 'active' | 'removed';
type SharedReminderRequestStatus =
  | 'pending_invitee_confirmation'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'invalidated';

interface FriendRequestRecord {
  id: string;
  requesterAccountId: string;
  targetAccountId: string;
  status: FriendRequestStatus;
  requester?: CustomerProfileRecord;
  target?: CustomerProfileRecord;
}

interface FriendRequestActionResult {
  id: string;
  status: FriendRequestStatus;
}

export interface FriendshipRecord {
  id: string;
  accountAId: string;
  accountBId: string;
  status: FriendshipStatus;
  accountA?: CustomerProfileRecord;
  accountB?: CustomerProfileRecord;
}

export interface CustomerProfileRecord {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

interface SharedReminderRequestRecord {
  id: string;
  requesterAccountId: string;
  inviteeAccountId: string;
  requesterReminderId?: string | null;
  status: SharedReminderRequestStatus;
}

interface ReminderProjectionRecord {
  id: string;
  sharedReminderRequestId: string;
  ownerAccountId: string;
  runtimeReminderId: string;
  role: 'requester' | 'invitee';
}

interface ProductNotificationDeliveryRecord {
  id: string;
  recipientAccountId: string;
  idempotencyKey: string;
  kind: string;
  payload: unknown;
}

interface RequesterProjectionCancellation {
  requestId: string;
  customerId: string;
  reminderId: string;
}

interface AcceptedFriendRequestNotificationInput {
  request: FriendRequestRecord;
  idempotencyKey: string;
}

interface AcceptFriendRequestWriteResult {
  request: FriendRequestRecord;
  notification: AcceptedFriendRequestNotificationInput | null;
}

interface ReminderRuntimePort {
  cancelRuntimeReminder(input: {
    customerId: string;
    reminderId: string;
  }): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
}

interface FriendshipClient {
  friendRequest: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
    }): Promise<FriendRequestRecord[]>;
    findUnique(args: {
      where: { id: string };
    }): Promise<FriendRequestRecord | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<FriendRequestRecord>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  friendship: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
    }): Promise<FriendshipRecord[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<FriendshipRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<FriendshipRecord>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  accountBlock: {
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
  sharedReminderRequest: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
    }): Promise<SharedReminderRequestRecord[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  reminderProjection: {
    findFirst(args: { where: Record<string, unknown> }): Promise<ReminderProjectionRecord | null>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
  productNotification: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<ProductNotificationDeliveryRecord[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  $transaction?<T>(fn: (client: FriendshipWriteClient) => Promise<T>): Promise<T>;
}

type FriendshipWriteClient = Omit<FriendshipClient, '$transaction'>;

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

function canonicalPair(a: string, b: string): { accountAId: string; accountBId: string } {
  return a <= b ? { accountAId: a, accountBId: b } : { accountAId: b, accountBId: a };
}

async function runWrite<T>(
  client: FriendshipClient,
  fn: (writeClient: FriendshipWriteClient) => Promise<T>,
): Promise<T> {
  if (client.$transaction) {
    return client.$transaction(fn);
  }
  return fn(client);
}

async function readFriendRequest(
  client: Pick<FriendshipClient, 'friendRequest'>,
  requestId: string,
): Promise<FriendRequestRecord> {
  const request = await client.friendRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    throw new Error('friend_request_not_found');
  }
  return request;
}

async function findActiveFriendship(
  client: Pick<FriendshipClient, 'friendship'>,
  accountAId: string,
  accountBId: string,
): Promise<FriendshipRecord | null> {
  return client.friendship.findFirst({
    where: { accountAId, accountBId, status: 'active' },
  });
}

async function ensureActiveFriendship(
  client: Pick<FriendshipClient, 'friendship'>,
  input: {
    accountAId: string;
    accountBId: string;
    friendRequestId: string;
  },
): Promise<FriendshipRecord> {
  try {
    return await client.friendship.create({
      data: {
        accountAId: input.accountAId,
        accountBId: input.accountBId,
        friendRequestId: input.friendRequestId,
        status: 'active',
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    const existing = await findActiveFriendship(client, input.accountAId, input.accountBId);
    if (!existing) {
      throw error;
    }
    return existing;
  }
}

async function createAcceptedNotification(
  client: Pick<FriendshipClient, 'productNotification'>,
  input: {
    request: FriendRequestRecord;
    idempotencyKey: string;
  },
): Promise<void> {
  await enqueueProductNotification(client, {
    requestId: input.request.id,
    requestType: 'friend_request',
    recipientAccountId: input.request.requesterAccountId,
    idempotencyKey: `friend-request:${input.request.id}:accepted:${input.idempotencyKey}`,
    kind: 'friend_request_accepted',
    text: '你的好友请求已通过。',
    metadata: {
      request_id: input.request.id,
      request_type: 'friend_request',
      actor_account_id: input.request.targetAccountId,
    },
  });
}

function sharedReminderPairWhere(input: {
  friendshipId: string | null;
  blockerAccountId: string;
  blockedAccountId: string;
  status?: SharedReminderRequestStatus;
}): Record<string, unknown> {
  const pair = [
    { requesterAccountId: input.blockerAccountId, inviteeAccountId: input.blockedAccountId },
    { requesterAccountId: input.blockedAccountId, inviteeAccountId: input.blockerAccountId },
  ];
  return {
    status: input.status ?? 'pending_invitee_confirmation',
    OR: input.friendshipId ? [{ friendshipId: input.friendshipId }, ...pair] : pair,
  };
}

async function ensureAcceptNotBlocked(
  client: Pick<FriendshipClient, 'accountBlock'>,
  request: FriendRequestRecord,
): Promise<void> {
  const block = await client.accountBlock.findFirst({
    where: {
      blockerAccountId: request.targetAccountId,
      blockedAccountId: request.requesterAccountId,
    },
  });
  if (block) {
    throw new Error('friend_request_blocked');
  }
}

function terminalRetryResult(
  request: FriendRequestRecord,
  input: {
    actorAccountId: string;
    actorField: 'requesterAccountId' | 'targetAccountId';
    intendedStatus: FriendRequestStatus;
  },
): { id: string; status: FriendRequestStatus } {
  if (
    request[input.actorField] === input.actorAccountId &&
    request.status === input.intendedStatus
  ) {
    return { id: request.id, status: request.status };
  }
  throw new Error('friend_request_not_found');
}

async function resolveRequesterReminderId(
  client: Pick<FriendshipClient, 'reminderProjection'>,
  request: SharedReminderRequestRecord,
): Promise<string | null | undefined> {
  if (request.requesterReminderId) {
    return request.requesterReminderId;
  }
  const projection = await client.reminderProjection.findFirst({
    where: {
      sharedReminderRequestId: request.id,
      role: 'requester',
    },
  });
  return projection?.runtimeReminderId;
}

async function cancelRequesterProjection(
  reminderRuntime: ReminderRuntimePort | null,
  input: RequesterProjectionCancellation,
): Promise<void> {
  if (!reminderRuntime) {
    throw new Error('reminder_projection_failed');
  }
  const result = await reminderRuntime.cancelRuntimeReminder({
    customerId: input.customerId,
    reminderId: input.reminderId,
  });
  if (!result.ok && result.error !== 'invalid_reminder') {
    throw new Error('reminder_projection_failed');
  }
}

async function cancelRequesterProjections(
  client: Pick<FriendshipClient, 'sharedReminderRequest' | 'reminderProjection' | '$transaction'>,
  reminderRuntime: ReminderRuntimePort | null,
  cancellations: RequesterProjectionCancellation[],
): Promise<void> {
  for (const cancellation of dedupeRequesterProjectionCancellations(cancellations)) {
    await cancelRequesterProjection(reminderRuntime, cancellation);
    await markRequesterProjectionCleanupComplete(client, cancellation);
  }
}

async function markRequesterProjectionCleanupComplete(
  client: Pick<FriendshipClient, 'sharedReminderRequest' | 'reminderProjection' | '$transaction'>,
  cancellation: RequesterProjectionCancellation,
): Promise<void> {
  const cleanup = async (
    cleanupClient: Pick<FriendshipClient, 'sharedReminderRequest' | 'reminderProjection'>,
  ): Promise<void> => {
    await cleanupClient.sharedReminderRequest.updateMany({
      where: {
        id: cancellation.requestId,
        status: 'invalidated',
        requesterReminderId: cancellation.reminderId,
      },
      data: { requesterReminderId: null },
    });
    await cleanupClient.reminderProjection.deleteMany({
      where: {
        sharedReminderRequestId: cancellation.requestId,
        role: 'requester',
        runtimeReminderId: cancellation.reminderId,
      },
    });
  };
  if (client.$transaction) {
    await client.$transaction(cleanup);
    return;
  }
  await cleanup(client);
}

function dedupeRequesterProjectionCancellations(
  cancellations: RequesterProjectionCancellation[],
): RequesterProjectionCancellation[] {
  const seen = new Set<string>();
  return cancellations.filter((cancellation) => {
    const key = `${cancellation.customerId}:${cancellation.reminderId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function collectRequesterProjectionCancellations(
  client: Pick<FriendshipClient, 'sharedReminderRequest' | 'reminderProjection'>,
  where: Record<string, unknown>,
): Promise<RequesterProjectionCancellation[]> {
  const requests = await client.sharedReminderRequest.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
  const requesterProjections: RequesterProjectionCancellation[] = [];
  for (const request of requests) {
    const requesterReminderId = await resolveRequesterReminderId(client, request);
    if (requesterReminderId) {
      requesterProjections.push({
        requestId: request.id,
        customerId: request.requesterAccountId,
        reminderId: requesterReminderId,
      });
    }
  }
  return requesterProjections;
}

async function invalidatePendingSharedReminders(
  client: Pick<FriendshipClient, 'sharedReminderRequest' | 'reminderProjection'>,
  where: Record<string, unknown>,
): Promise<{ count: number; requesterProjections: RequesterProjectionCancellation[] }> {
  const pendingRequests = await client.sharedReminderRequest.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
  const requesterProjections: RequesterProjectionCancellation[] = [];
  let count = 0;
  for (const request of pendingRequests) {
    const result = await client.sharedReminderRequest.updateMany({
      where: { id: request.id, status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: new Date() },
    });
    if (result.count !== 1) {
      continue;
    }
    count += 1;
    const requesterReminderId = await resolveRequesterReminderId(client, request);
    if (requesterReminderId) {
      requesterProjections.push({
        requestId: request.id,
        customerId: request.requesterAccountId,
        reminderId: requesterReminderId,
      });
    }
  }
  return { count, requesterProjections };
}

async function collectInvalidatedSharedReminderCleanup(
  client: Pick<FriendshipClient, 'sharedReminderRequest' | 'reminderProjection'>,
  where: Record<string, unknown>,
): Promise<RequesterProjectionCancellation[]> {
  return collectRequesterProjectionCancellations(client, where);
}

export async function listFriendRequests(
  client: FriendshipClient,
  input: { accountId: string },
): Promise<FriendRequestRecord[]> {
  const accountId = nonEmpty(input.accountId, 'invalid_account');
  return client.friendRequest.findMany({
    where: {
      OR: [{ requesterAccountId: accountId }, { targetAccountId: accountId }],
    },
    include: {
      requester: { select: { id: true, displayName: true, avatarUrl: true } },
      target: { select: { id: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function acceptFriendRequest(
  client: FriendshipClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<FriendRequestRecord> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'friend_request_not_found');
  const idempotencyKey = nonEmpty(input.idempotencyKey, 'invalid_idempotency_key');

  const result = await runWrite(client, async (writeClient): Promise<AcceptFriendRequestWriteResult> => {
    const transition = await writeClient.friendRequest.updateMany({
      where: { id: requestId, status: 'pending', targetAccountId: actorAccountId },
      data: { status: 'accepted', resolvedAt: new Date() },
    });
    const request = await readFriendRequest(writeClient, requestId);
    if (transition.count !== 1) {
      if (request.targetAccountId !== actorAccountId || request.status !== 'accepted') {
        throw new Error('friend_request_not_found');
      }
    }

    await ensureAcceptNotBlocked(writeClient, request);
    const pair = canonicalPair(request.requesterAccountId, request.targetAccountId);
    if (transition.count === 1) {
      await ensureActiveFriendship(writeClient, { ...pair, friendRequestId: request.id });
    } else {
      const friendship = await findActiveFriendship(writeClient, pair.accountAId, pair.accountBId);
      if (!friendship) {
        throw new Error('friendship_not_found');
      }
    }
    return {
      request,
      notification: {
        request,
        idempotencyKey,
      },
    };
  });

  if (result.notification) {
    await createAcceptedNotification(client, result.notification);
  }
  return result.request;
}

export async function rejectFriendRequest(
  client: FriendshipClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<FriendRequestActionResult> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'friend_request_not_found');
  nonEmpty(input.idempotencyKey, 'invalid_idempotency_key');

  return runWrite(client, async (writeClient) => {
    const transition = await writeClient.friendRequest.updateMany({
      where: { id: requestId, status: 'pending', targetAccountId: actorAccountId },
      data: { status: 'rejected', resolvedAt: new Date() },
    });
    if (transition.count === 1) {
      return { id: requestId, status: 'rejected' };
    }
    const request = await readFriendRequest(writeClient, requestId);
    return terminalRetryResult(request, {
      actorAccountId,
      actorField: 'targetAccountId',
      intendedStatus: 'rejected',
    });
  });
}

export async function cancelFriendRequest(
  client: FriendshipClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<FriendRequestActionResult> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'friend_request_not_found');
  nonEmpty(input.idempotencyKey, 'invalid_idempotency_key');

  return runWrite(client, async (writeClient) => {
    const transition = await writeClient.friendRequest.updateMany({
      where: { id: requestId, status: 'pending', requesterAccountId: actorAccountId },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    if (transition.count === 1) {
      return { id: requestId, status: 'cancelled' };
    }
    const request = await readFriendRequest(writeClient, requestId);
    return terminalRetryResult(request, {
      actorAccountId,
      actorField: 'requesterAccountId',
      intendedStatus: 'cancelled',
    });
  });
}

export async function listFriends(
  client: FriendshipClient,
  input: { accountId: string },
): Promise<FriendshipRecord[]> {
  const accountId = nonEmpty(input.accountId, 'invalid_account');
  return client.friendship.findMany({
    where: {
      status: 'active',
      OR: [{ accountAId: accountId }, { accountBId: accountId }],
    },
    include: {
      accountA: { select: { id: true, displayName: true, avatarUrl: true } },
      accountB: { select: { id: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function removeFriendship(
  client: FriendshipClient,
  runtimeOrInput: ReminderRuntimePort | { actorAccountId: string; friendshipId: string },
  maybeInput?: { actorAccountId: string; friendshipId: string },
): Promise<{ id: string; status: FriendshipStatus }> {
  const reminderRuntime = maybeInput ? (runtimeOrInput as ReminderRuntimePort) : null;
  const input = maybeInput ?? (runtimeOrInput as { actorAccountId: string; friendshipId: string });
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const friendshipId = nonEmpty(input.friendshipId, 'friendship_not_found');

  const result = await runWrite(client, async (writeClient) => {
    const friendship = await writeClient.friendship.findFirst({
      where: {
        id: friendshipId,
        status: 'active',
        OR: [{ accountAId: actorAccountId }, { accountBId: actorAccountId }],
      },
    });
    if (!friendship) {
      const removedFriendship = await writeClient.friendship.findFirst({
        where: {
          id: friendshipId,
          status: 'removed',
          OR: [{ accountAId: actorAccountId }, { accountBId: actorAccountId }],
        },
      });
      if (!removedFriendship) {
        throw new Error('friendship_not_found');
      }
      const requesterProjections = await collectInvalidatedSharedReminderCleanup(
        writeClient,
        {
          friendshipId: removedFriendship.id,
          status: 'invalidated',
        },
      );
      return {
        friendship: { id: removedFriendship.id, status: 'removed' as const },
        requesterProjections,
      };
    }

    await writeClient.friendship.updateMany({
      where: { id: friendship.id, status: 'active' },
      data: { status: 'removed', removedAt: new Date() },
    });
    const invalidation = await invalidatePendingSharedReminders(
      writeClient,
      {
        friendshipId: friendship.id,
        status: 'pending_invitee_confirmation',
      },
    );
    const invalidatedCleanup = await collectInvalidatedSharedReminderCleanup(
      writeClient,
      {
        friendshipId: friendship.id,
        status: 'invalidated',
      },
    );
    return {
      friendship: { id: friendship.id, status: 'removed' as const },
      requesterProjections: [
        ...invalidation.requesterProjections,
        ...invalidatedCleanup,
      ],
    };
  });
  await cancelRequesterProjections(client, reminderRuntime, result.requesterProjections);
  return result.friendship;
}

export async function blockAccount(
  client: FriendshipClient,
  runtimeOrInput: ReminderRuntimePort | { blockerAccountId: string; blockedAccountId: string },
  maybeInput?: { blockerAccountId: string; blockedAccountId: string },
): Promise<{ blockerAccountId: string; blockedAccountId: string }> {
  const reminderRuntime = maybeInput ? (runtimeOrInput as ReminderRuntimePort) : null;
  const input = maybeInput ?? (runtimeOrInput as { blockerAccountId: string; blockedAccountId: string });
  const blockerAccountId = nonEmpty(input.blockerAccountId, 'invalid_account');
  const blockedAccountId = nonEmpty(input.blockedAccountId, 'invalid_account');
  if (blockerAccountId === blockedAccountId) {
    throw new Error('cannot_friend_self');
  }

  const result = await runWrite(client, async (writeClient) => {
    await writeClient.friendRequest.updateMany({
      where: {
        status: 'pending',
        OR: [
          { requesterAccountId: blockedAccountId, targetAccountId: blockerAccountId },
          { requesterAccountId: blockerAccountId, targetAccountId: blockedAccountId },
        ],
      },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });

    try {
      await writeClient.accountBlock.create({
        data: { blockerAccountId, blockedAccountId },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
    }

    const pair = canonicalPair(blockerAccountId, blockedAccountId);
    const friendship = await findActiveFriendship(writeClient, pair.accountAId, pair.accountBId);
    if (friendship) {
      await writeClient.friendship.updateMany({
        where: { id: friendship.id, status: 'active' },
        data: { status: 'removed', removedAt: new Date() },
      });
    }
    const invalidation = await invalidatePendingSharedReminders(
      writeClient,
      sharedReminderPairWhere({
        friendshipId: friendship?.id ?? null,
        blockerAccountId,
        blockedAccountId,
      }),
    );
    const invalidatedCleanup = await collectInvalidatedSharedReminderCleanup(
      writeClient,
      sharedReminderPairWhere({
        friendshipId: friendship?.id ?? null,
        blockerAccountId,
        blockedAccountId,
        status: 'invalidated',
      }),
    );

    return {
      block: { blockerAccountId, blockedAccountId },
      requesterProjections: [
        ...invalidation.requesterProjections,
        ...invalidatedCleanup,
      ],
    };
  });
  await cancelRequesterProjections(client, reminderRuntime, result.requesterProjections);
  return result.block;
}

export async function unblockAccount(
  client: FriendshipClient,
  input: { blockerAccountId: string; blockedAccountId: string },
): Promise<{ blockerAccountId: string; blockedAccountId: string }> {
  const blockerAccountId = nonEmpty(input.blockerAccountId, 'invalid_account');
  const blockedAccountId = nonEmpty(input.blockedAccountId, 'invalid_account');

  await client.accountBlock.deleteMany({
    where: { blockerAccountId, blockedAccountId },
  });
  return { blockerAccountId, blockedAccountId };
}
