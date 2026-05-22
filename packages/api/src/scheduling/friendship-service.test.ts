import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptFriendRequest,
  blockAccount,
  cancelFriendRequest,
  rejectFriendRequest,
  removeFriendship,
} from './friendship-service.js';

const db = {
  friendRequest: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  friendship: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  accountBlock: {
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  sharedReminderRequest: {
    updateMany: vi.fn(),
  },
  productNotification: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

describe('friendship service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn) => fn(db));
  });

  it('accepting a pending request creates an active canonical friendship and marks the request accepted', async () => {
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_z',
      targetAccountId: 'ck_a',
      status: 'pending',
    });
    db.friendship.create.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_z',
      status: 'active',
    });
    db.friendRequest.update.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_z',
      targetAccountId: 'ck_a',
      status: 'accepted',
    });

    const result = await acceptFriendRequest(db as never, {
      actorAccountId: 'ck_a',
      requestId: 'fr_1',
      idempotencyKey: 'idem_accept',
    });

    expect(result).toMatchObject({ id: 'fr_1', status: 'accepted' });
    expect(db.friendship.create).toHaveBeenCalledWith({
      data: {
        accountAId: 'ck_a',
        accountBId: 'ck_z',
        friendRequestId: 'fr_1',
        status: 'active',
      },
    });
    expect(db.friendRequest.update).toHaveBeenCalledWith({
      where: { id: 'fr_1' },
      data: { status: 'accepted', resolvedAt: expect.any(Date) },
    });
    expect(db.productNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        friendRequestId: 'fr_1',
        recipientAccountId: 'ck_z',
        idempotencyKey: 'friend-request:fr_1:accepted:idem_accept',
        kind: 'friend_request_accepted',
      }),
    });
  });

  it('rejecting a pending request marks it rejected without creating a friendship', async () => {
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'pending',
    });
    db.friendRequest.update.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'rejected',
    });

    await rejectFriendRequest(db as never, {
      actorAccountId: 'ck_a',
      requestId: 'fr_1',
      idempotencyKey: 'idem_reject',
    });

    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.friendRequest.update).toHaveBeenCalledWith({
      where: { id: 'fr_1' },
      data: { status: 'rejected', resolvedAt: expect.any(Date) },
    });
  });

  it('canceling a pending request requires the requester actor and does not create a friendship', async () => {
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'pending',
    });
    db.friendRequest.update.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'cancelled',
    });

    await cancelFriendRequest(db as never, {
      actorAccountId: 'ck_b',
      requestId: 'fr_1',
      idempotencyKey: 'idem_cancel',
    });

    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.friendRequest.update).toHaveBeenCalledWith({
      where: { id: 'fr_1' },
      data: { status: 'cancelled', resolvedAt: expect.any(Date) },
    });
  });

  it('rejects an unauthorized actor for request transitions', async () => {
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'pending',
    });

    await expect(
      acceptFriendRequest(db as never, {
        actorAccountId: 'ck_b',
        requestId: 'fr_1',
        idempotencyKey: 'idem_wrong_actor',
      }),
    ).rejects.toThrow('not_allowed');

    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.friendRequest.update).not.toHaveBeenCalled();
  });

  it('blocking an account removes active friendship and invalidates pending shared reminders for the pair', async () => {
    db.accountBlock.create.mockResolvedValueOnce({ id: 'blk_1' });
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 2 });

    await blockAccount(db as never, {
      blockerAccountId: 'ck_b',
      blockedAccountId: 'ck_a',
    });

    expect(db.accountBlock.create).toHaveBeenCalledWith({
      data: { blockerAccountId: 'ck_b', blockedAccountId: 'ck_a' },
    });
    expect(db.friendship.findFirst).toHaveBeenCalledWith({
      where: { accountAId: 'ck_a', accountBId: 'ck_b', status: 'active' },
    });
    expect(db.friendship.updateMany).toHaveBeenCalledWith({
      where: { id: 'fs_1', status: 'active' },
      data: { status: 'removed', removedAt: expect.any(Date) },
    });
    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'pending_invitee_confirmation',
        OR: [
          { friendshipId: 'fs_1' },
          { requesterAccountId: 'ck_b', inviteeAccountId: 'ck_a' },
          { requesterAccountId: 'ck_a', inviteeAccountId: 'ck_b' },
        ],
      },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
  });

  it('treats duplicate block creation as a successful retry', async () => {
    db.accountBlock.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    db.friendship.findFirst.mockResolvedValueOnce(null);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      blockAccount(db as never, {
        blockerAccountId: 'ck_b',
        blockedAccountId: 'ck_a',
      }),
    ).resolves.toEqual({ blockedAccountId: 'ck_a', blockerAccountId: 'ck_b' });
  });

  it('removing a friendship invalidates pending shared reminders but not accepted shared reminders', async () => {
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    await removeFriendship(db as never, {
      actorAccountId: 'ck_b',
      friendshipId: 'fs_1',
    });

    expect(db.friendship.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'fs_1',
        status: 'active',
        OR: [{ accountAId: 'ck_b' }, { accountBId: 'ck_b' }],
      },
    });
    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { friendshipId: 'fs_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
  });
});
