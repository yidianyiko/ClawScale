type ActorRole = 'requester' | 'target';

type CustomerProfileRecord = {
  id?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

type FriendRequestRecord = {
  id: string;
  requesterAccountId: string;
  targetAccountId: string;
  status: string;
  requester?: CustomerProfileRecord | null;
  target?: CustomerProfileRecord | null;
};

type FriendshipRecord = {
  id: string;
  accountAId: string;
  accountBId: string;
  status: string;
  accountA?: CustomerProfileRecord | null;
  accountB?: CustomerProfileRecord | null;
};

export type FriendTargetResolverClient = {
  listFriendRequests?(accountId: string): Promise<FriendRequestRecord[]>;
  listFriends?(accountId: string): Promise<FriendshipRecord[]>;
  friendRequest?: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
    }): Promise<FriendRequestRecord[]>;
  };
  friendship?: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
    }): Promise<FriendshipRecord[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<FriendshipRecord | null>;
  };
};

export type PendingRequestResolveInput = {
  actorRole: ActorRole;
  actorAccountId: string;
  friendName?: string | null;
  requestId?: string | null;
};

export type ActiveFriendshipResolveInput = {
  actorAccountId: string;
  friendName?: string | null;
  friendshipId?: string | null;
};

export type ActiveFriendReadResolveInput = {
  actorAccountId: string;
  friendName?: string | null;
  targetAccountId?: string | null;
};

export type SharedReminderInviteeResolveInput = {
  actorAccountId: string;
  friendName?: string | null;
  inviteeAccountId?: string | null;
};

function normalizedName(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function trimmed(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenBoundaryMatches(displayName: string, query: string): boolean {
  if (!query) {
    return false;
  }
  return new RegExp(`\\b${escapeRegExp(query)}\\b`, 'u').test(displayName);
}

function pickByName<T>(
  candidates: T[],
  displayName: (candidate: T) => string,
  query: string,
  notFoundCode: string,
): T[] {
  const normalizedQuery = normalizedName(query);
  if (!normalizedQuery) {
    return candidates;
  }

  const exact = candidates.filter(
    (candidate) => normalizedName(displayName(candidate)) === normalizedQuery,
  );
  if (exact.length > 0) {
    return exact;
  }

  const token = candidates.filter((candidate) =>
    tokenBoundaryMatches(normalizedName(displayName(candidate)), normalizedQuery),
  );
  if (token.length > 0) {
    return token;
  }

  throw new Error(notFoundCode);
}

function requireUnique<T>(
  candidates: T[],
  input: {
    hasName: boolean;
    notFoundCode: string;
    ambiguousCode: string;
    unnamedNotFoundCode: string;
    unnamedAmbiguousCode: string;
  },
): T {
  if (candidates.length === 0) {
    throw new Error(input.hasName ? input.notFoundCode : input.unnamedNotFoundCode);
  }
  if (candidates.length > 1) {
    throw new Error(input.hasName ? input.ambiguousCode : input.unnamedAmbiguousCode);
  }
  return candidates[0] as T;
}

function actorFieldForRole(role: ActorRole): 'requesterAccountId' | 'targetAccountId' {
  return role === 'requester' ? 'requesterAccountId' : 'targetAccountId';
}

function requestCounterpartyName(
  request: FriendRequestRecord,
  actorRole: ActorRole,
): string {
  return actorRole === 'requester'
    ? request.target?.displayName ?? ''
    : request.requester?.displayName ?? '';
}

function friendshipOtherAccountId(
  friendship: FriendshipRecord,
  actorAccountId: string,
): string | null {
  if (friendship.accountAId === actorAccountId) return friendship.accountBId;
  if (friendship.accountBId === actorAccountId) return friendship.accountAId;
  return null;
}

function friendshipOtherDisplayName(
  friendship: FriendshipRecord,
  actorAccountId: string,
): string {
  if (friendship.accountAId === actorAccountId) {
    return friendship.accountB?.displayName ?? '';
  }
  if (friendship.accountBId === actorAccountId) {
    return friendship.accountA?.displayName ?? '';
  }
  return '';
}

async function listPendingRequests(
  client: FriendTargetResolverClient,
  actorAccountId: string,
  actorRole: ActorRole,
): Promise<FriendRequestRecord[]> {
  const actorField = actorFieldForRole(actorRole);
  const requests = client.listFriendRequests
    ? await client.listFriendRequests(actorAccountId)
    : await client.friendRequest?.findMany({
        where: { status: 'pending', [actorField]: actorAccountId },
        include: {
          requester: { select: { id: true, displayName: true, avatarUrl: true } },
          target: { select: { id: true, displayName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
  return (requests ?? []).filter(
    (request) => request.status === 'pending' && request[actorField] === actorAccountId,
  );
}

async function listActiveFriendships(
  client: FriendTargetResolverClient,
  actorAccountId: string,
): Promise<FriendshipRecord[]> {
  const friendships = client.listFriends
    ? await client.listFriends(actorAccountId)
    : await client.friendship?.findMany({
        where: {
          status: 'active',
          OR: [{ accountAId: actorAccountId }, { accountBId: actorAccountId }],
        },
        include: {
          accountA: { select: { id: true, displayName: true, avatarUrl: true } },
          accountB: { select: { id: true, displayName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
  return (friendships ?? []).filter(
    (friendship) =>
      friendship.status === 'active' &&
      (friendship.accountAId === actorAccountId ||
        friendship.accountBId === actorAccountId),
  );
}

async function validateExplicitFriendTarget(
  client: FriendTargetResolverClient,
  actorAccountId: string,
  targetAccountId: string,
): Promise<void> {
  if (client.friendship?.findFirst && !client.listFriends) {
    const friendship = await client.friendship.findFirst({
      where: {
        status: 'active',
        OR: [
          { accountAId: actorAccountId, accountBId: targetAccountId },
          { accountAId: targetAccountId, accountBId: actorAccountId },
        ],
      },
    });
    if (!friendship) {
      throw new Error('friend_not_found');
    }
    return;
  }
  const friendships = await listActiveFriendships(client, actorAccountId);
  if (!friendships.some((friendship) => friendshipOtherAccountId(friendship, actorAccountId) === targetAccountId)) {
    throw new Error('friend_not_found');
  }
}

export async function resolvePendingRequestForAction(
  client: FriendTargetResolverClient,
  input: PendingRequestResolveInput,
): Promise<{ requestId: string }> {
  const actorAccountId = trimmed(input.actorAccountId);
  if (!actorAccountId) {
    throw new Error('invalid_account');
  }
  const requestId = trimmed(input.requestId);
  if (requestId) {
    return { requestId };
  }

  const pending = await listPendingRequests(client, actorAccountId, input.actorRole);
  const friendName = normalizedName(input.friendName);
  const matches = pickByName(
    pending,
    (request) => requestCounterpartyName(request, input.actorRole),
    friendName,
    'friend_name_not_found',
  );
  const selected = requireUnique(matches, {
    hasName: Boolean(friendName),
    notFoundCode: 'friend_name_not_found',
    ambiguousCode: 'friend_name_ambiguous',
    unnamedNotFoundCode: 'friend_request_not_found',
    unnamedAmbiguousCode: 'friend_request_ambiguous',
  });
  return { requestId: selected.id };
}

export async function resolveActiveFriendshipForMutation(
  client: FriendTargetResolverClient,
  input: ActiveFriendshipResolveInput,
): Promise<{ friendshipId: string; otherAccountId: string }> {
  const actorAccountId = trimmed(input.actorAccountId);
  if (!actorAccountId) {
    throw new Error('invalid_account');
  }
  const friendshipId = trimmed(input.friendshipId);
  if (friendshipId) {
    return { friendshipId, otherAccountId: '' };
  }
  const friendships = await listActiveFriendships(client, actorAccountId);
  const friendName = normalizedName(input.friendName);
  const matches = pickByName(
    friendships,
    (friendship) => friendshipOtherDisplayName(friendship, actorAccountId),
    friendName,
    'friend_name_not_found',
  );
  const selected = requireUnique(matches, {
    hasName: Boolean(friendName),
    notFoundCode: 'friend_name_not_found',
    ambiguousCode: 'friend_name_ambiguous',
    unnamedNotFoundCode: 'friendship_not_found',
    unnamedAmbiguousCode: 'friendship_ambiguous',
  });
  const otherAccountId = friendshipOtherAccountId(selected, actorAccountId);
  if (!otherAccountId) {
    throw new Error('friendship_not_found');
  }
  return { friendshipId: selected.id, otherAccountId };
}

export async function resolveActiveFriendForRead(
  client: FriendTargetResolverClient,
  input: ActiveFriendReadResolveInput,
): Promise<{ otherAccountId: string }> {
  const actorAccountId = trimmed(input.actorAccountId);
  if (!actorAccountId) {
    throw new Error('invalid_account');
  }
  const targetAccountId = trimmed(input.targetAccountId);
  if (targetAccountId) {
    return { otherAccountId: targetAccountId };
  }
  const friendName = normalizedName(input.friendName);
  if (!friendName) {
    throw new Error('friend_not_found');
  }
  const friendships = await listActiveFriendships(client, actorAccountId);
  const selected = requireUnique(
    pickByName(
      friendships,
      (friendship) => friendshipOtherDisplayName(friendship, actorAccountId),
      friendName,
      'friend_not_found',
    ),
    {
      hasName: true,
      notFoundCode: 'friend_not_found',
      ambiguousCode: 'friend_name_ambiguous',
      unnamedNotFoundCode: 'friend_not_found',
      unnamedAmbiguousCode: 'friend_name_ambiguous',
    },
  );
  const otherAccountId = friendshipOtherAccountId(selected, actorAccountId);
  if (!otherAccountId) {
    throw new Error('friend_not_found');
  }
  return { otherAccountId };
}

export async function resolveSharedReminderInvitee(
  client: FriendTargetResolverClient,
  input: SharedReminderInviteeResolveInput,
): Promise<{ otherAccountId: string }> {
  return resolveActiveFriendForRead(client, {
    actorAccountId: input.actorAccountId,
    targetAccountId: input.inviteeAccountId,
    friendName: input.friendName,
  });
}
