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
}

interface FriendshipRecord {
  id: string;
  accountAId: string;
  accountBId: string;
  status: FriendshipStatus;
}

interface FriendshipClient {
  friendRequest: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
    }): Promise<FriendRequestRecord[]>;
    findUnique(args: {
      where: { id: string };
    }): Promise<FriendRequestRecord | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<FriendRequestRecord>;
  };
  friendship: {
    findMany(args: {
      where: Record<string, unknown>;
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
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
  sharedReminderRequest: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: {
        status: SharedReminderRequestStatus;
        resolvedAt: Date;
      };
    }): Promise<{ count: number }>;
  };
  productNotification: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
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

function assertPendingRequest(request: FriendRequestRecord): void {
  if (request.status !== 'pending') {
    throw new Error('friend_request_not_found');
  }
}

function assertTargetActor(request: FriendRequestRecord, actorAccountId: string): void {
  if (request.targetAccountId !== actorAccountId) {
    throw new Error('not_allowed');
  }
}

function assertRequesterActor(request: FriendRequestRecord, actorAccountId: string): void {
  if (request.requesterAccountId !== actorAccountId) {
    throw new Error('not_allowed');
  }
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
  try {
    await client.productNotification.create({
      data: {
        friendRequestId: input.request.id,
        recipientAccountId: input.request.requesterAccountId,
        idempotencyKey: `friend-request:${input.request.id}:accepted:${input.idempotencyKey}`,
        kind: 'friend_request_accepted',
        payload: {
          text: '你的好友请求已通过。',
          metadata: {
            request_id: input.request.id,
            request_type: 'friend_request',
            actor_account_id: input.request.targetAccountId,
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

async function updateRequestStatus(
  client: Pick<FriendshipClient, 'friendRequest'>,
  requestId: string,
  status: FriendRequestStatus,
): Promise<FriendRequestRecord> {
  return client.friendRequest.update({
    where: { id: requestId },
    data: { status, resolvedAt: new Date() },
  });
}

function sharedReminderPairWhere(input: {
  friendshipId: string | null;
  blockerAccountId: string;
  blockedAccountId: string;
}): Record<string, unknown> {
  const pair = [
    { requesterAccountId: input.blockerAccountId, inviteeAccountId: input.blockedAccountId },
    { requesterAccountId: input.blockedAccountId, inviteeAccountId: input.blockerAccountId },
  ];
  return {
    status: 'pending_invitee_confirmation',
    OR: input.friendshipId ? [{ friendshipId: input.friendshipId }, ...pair] : pair,
  };
}

async function invalidatePendingSharedReminders(
  client: Pick<FriendshipClient, 'sharedReminderRequest'>,
  where: Record<string, unknown>,
): Promise<{ count: number }> {
  return client.sharedReminderRequest.updateMany({
    where,
    data: { status: 'invalidated', resolvedAt: new Date() },
  });
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

  return runWrite(client, async (writeClient) => {
    const request = await readFriendRequest(writeClient, requestId);
    if (request.status === 'accepted' && request.targetAccountId === actorAccountId) {
      const pair = canonicalPair(request.requesterAccountId, request.targetAccountId);
      await ensureActiveFriendship(writeClient, { ...pair, friendRequestId: request.id });
      return request;
    }
    assertPendingRequest(request);
    assertTargetActor(request, actorAccountId);

    const pair = canonicalPair(request.requesterAccountId, request.targetAccountId);
    await ensureActiveFriendship(writeClient, { ...pair, friendRequestId: request.id });
    const updated = await updateRequestStatus(writeClient, request.id, 'accepted');
    await createAcceptedNotification(writeClient, { request, idempotencyKey });
    return updated;
  });
}

export async function rejectFriendRequest(
  client: FriendshipClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<FriendRequestRecord> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'friend_request_not_found');
  nonEmpty(input.idempotencyKey, 'invalid_idempotency_key');

  return runWrite(client, async (writeClient) => {
    const request = await readFriendRequest(writeClient, requestId);
    assertPendingRequest(request);
    assertTargetActor(request, actorAccountId);
    return updateRequestStatus(writeClient, request.id, 'rejected');
  });
}

export async function cancelFriendRequest(
  client: FriendshipClient,
  input: { actorAccountId: string; requestId: string; idempotencyKey: string },
): Promise<FriendRequestRecord> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const requestId = nonEmpty(input.requestId, 'friend_request_not_found');
  nonEmpty(input.idempotencyKey, 'invalid_idempotency_key');

  return runWrite(client, async (writeClient) => {
    const request = await readFriendRequest(writeClient, requestId);
    assertPendingRequest(request);
    assertRequesterActor(request, actorAccountId);
    return updateRequestStatus(writeClient, request.id, 'cancelled');
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
    orderBy: { createdAt: 'desc' },
  });
}

export async function removeFriendship(
  client: FriendshipClient,
  input: { actorAccountId: string; friendshipId: string },
): Promise<{ id: string; status: FriendshipStatus }> {
  const actorAccountId = nonEmpty(input.actorAccountId, 'invalid_account');
  const friendshipId = nonEmpty(input.friendshipId, 'friendship_not_found');

  return runWrite(client, async (writeClient) => {
    const friendship = await writeClient.friendship.findFirst({
      where: {
        id: friendshipId,
        status: 'active',
        OR: [{ accountAId: actorAccountId }, { accountBId: actorAccountId }],
      },
    });
    if (!friendship) {
      throw new Error('friendship_not_found');
    }

    await writeClient.friendship.updateMany({
      where: { id: friendship.id, status: 'active' },
      data: { status: 'removed', removedAt: new Date() },
    });
    await invalidatePendingSharedReminders(writeClient, {
      friendshipId: friendship.id,
      status: 'pending_invitee_confirmation',
    });
    return { id: friendship.id, status: 'removed' };
  });
}

export async function blockAccount(
  client: FriendshipClient,
  input: { blockerAccountId: string; blockedAccountId: string },
): Promise<{ blockerAccountId: string; blockedAccountId: string }> {
  const blockerAccountId = nonEmpty(input.blockerAccountId, 'invalid_account');
  const blockedAccountId = nonEmpty(input.blockedAccountId, 'invalid_account');
  if (blockerAccountId === blockedAccountId) {
    throw new Error('cannot_friend_self');
  }

  return runWrite(client, async (writeClient) => {
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
    await invalidatePendingSharedReminders(
      writeClient,
      sharedReminderPairWhere({
        friendshipId: friendship?.id ?? null,
        blockerAccountId,
        blockedAccountId,
      }),
    );

    return { blockerAccountId, blockedAccountId };
  });
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
