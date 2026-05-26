import { describe, expect, it, vi } from 'vitest';
import {
  resolveActiveFriendForRead,
  resolveActiveFriendshipForMutation,
  resolvePendingRequestForAction,
  resolveSharedReminderInvitee,
} from './friend-target-resolver.js';

function clientWith(state: {
  friendRequests?: Record<string, unknown>[];
  friendships?: Record<string, unknown>[];
}) {
  return {
    friendRequest: {
      findMany: vi.fn().mockResolvedValue(state.friendRequests ?? []),
      findUnique: vi.fn(),
    },
    friendship: {
      findMany: vi.fn().mockResolvedValue(state.friendships ?? []),
      findFirst: vi.fn(),
    },
  };
}

describe('friend target resolver', () => {
  it('resolves pending request names by token boundary without arbitrary substring matching', async () => {
    const client = clientWith({
      friendRequests: [
        {
          id: 'fr_bobby',
          requesterAccountId: 'acct_bobby',
          targetAccountId: 'acct_alice',
          status: 'pending',
          requester: { id: 'acct_bobby', displayName: 'Bobby Friend' },
        },
      ],
    });

    await expect(
      resolvePendingRequestForAction(client as never, {
        actorRole: 'target',
        actorAccountId: 'acct_alice',
        friendName: 'Bob',
      }),
    ).rejects.toThrow('friend_name_not_found');
  });

  it('resolves active friend reads by exact match before ambiguous token matches', async () => {
    const client = clientWith({
      friendships: [
        {
          id: 'fs_exact',
          accountAId: 'acct_alice',
          accountBId: 'acct_bob_exact',
          status: 'active',
          accountA: { id: 'acct_alice', displayName: 'Alice' },
          accountB: { id: 'acct_bob_exact', displayName: 'Bob' },
        },
        {
          id: 'fs_token',
          accountAId: 'acct_alice',
          accountBId: 'acct_bob_friend',
          status: 'active',
          accountA: { id: 'acct_alice', displayName: 'Alice' },
          accountB: { id: 'acct_bob_friend', displayName: 'Bob Friend' },
        },
      ],
    });

    await expect(
      resolveActiveFriendForRead(client as never, {
        actorAccountId: 'acct_alice',
        friendName: 'Bob',
      }),
    ).resolves.toEqual({ otherAccountId: 'acct_bob_exact' });
  });

  it('fails closed when active friend token matches are ambiguous', async () => {
    const client = clientWith({
      friendships: [
        {
          id: 'fs_1',
          accountAId: 'acct_alice',
          accountBId: 'acct_bob_1',
          status: 'active',
          accountA: { id: 'acct_alice', displayName: 'Alice' },
          accountB: { id: 'acct_bob_1', displayName: 'Bob Friend' },
        },
        {
          id: 'fs_2',
          accountAId: 'acct_alice',
          accountBId: 'acct_bob_2',
          status: 'active',
          accountA: { id: 'acct_alice', displayName: 'Alice' },
          accountB: { id: 'acct_bob_2', displayName: 'Bob Buddy' },
        },
      ],
    });

    await expect(
      resolveActiveFriendshipForMutation(client as never, {
        actorAccountId: 'acct_alice',
        friendName: 'Bob',
      }),
    ).rejects.toThrow('friend_name_ambiguous');
  });

  it('returns explicit invitee ids for downstream service ownership validation', async () => {
    const client = clientWith({});

    await expect(
      resolveSharedReminderInvitee(client as never, {
        actorAccountId: 'acct_alice',
        inviteeAccountId: 'acct_bob',
        friendName: '',
      }),
    ).resolves.toEqual({ otherAccountId: 'acct_bob' });
  });
});
