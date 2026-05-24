import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptFriendRequest,
  blockAccount,
  cancelFriendRequest,
  listFriends,
  rejectFriendRequest,
  removeFriendship,
} from './friendship-service.js';

const db = {
  friendRequest: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  friendship: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  accountBlock: {
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  sharedReminderRequest: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  reminderProjection: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  productNotification: {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

describe('friendship service', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    db.$transaction.mockImplementation(async (fn) => fn(db));
    db.sharedReminderRequest.findMany.mockResolvedValue([]);
    db.reminderProjection.findFirst.mockResolvedValue(null);
    db.reminderProjection.deleteMany.mockResolvedValue({ count: 0 });
    db.productNotification.create.mockResolvedValue({
      id: 'pn_1',
      recipientAccountId: 'ck_z',
      idempotencyKey: 'friend-request:fr_1:accepted:idem_accept',
      kind: 'friend_request_accepted',
      payload: {
        text: '你的好友请求已通过。',
        metadata: {
          request_id: 'fr_1',
          request_type: 'friend_request',
          actor_account_id: 'ck_a',
        },
      },
      status: 'pending_delivery',
    });
    db.productNotification.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function fakeReminderRuntime(state: {
    cancel?: { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
  } = {}) {
    return {
      cancelRuntimeReminder: vi.fn().mockResolvedValue(state.cancel ?? { ok: true, data: { id: 'rem_1' } }),
    };
  }

  it('accepting a pending request creates an active canonical friendship and marks the request accepted', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_z',
      targetAccountId: 'ck_a',
      status: 'accepted',
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendship.create.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_z',
      status: 'active',
    });

    const result = await acceptFriendRequest(db as never, {
      actorAccountId: 'ck_a',
      requestId: 'fr_1',
      idempotencyKey: 'idem_accept',
    });

    expect(result).toMatchObject({ id: 'fr_1', status: 'accepted' });
    expect(db.friendRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'fr_1', status: 'pending', targetAccountId: 'ck_a' },
      data: { status: 'accepted', resolvedAt: expect.any(Date) },
    });
    expect(db.accountBlock.findFirst).toHaveBeenCalledWith({
      where: { blockerAccountId: 'ck_a', blockedAccountId: 'ck_z' },
    });
    expect(db.friendship.create).toHaveBeenCalledWith({
      data: {
        accountAId: 'ck_a',
        accountBId: 'ck_z',
        friendRequestId: 'fr_1',
        status: 'active',
      },
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

  it('delivers accepted friend-request notifications to the bridge immediately', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_z',
      targetAccountId: 'ck_a',
      status: 'accepted',
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendship.create.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_z',
      status: 'active',
    });

    await acceptFriendRequest(db as never, {
      actorAccountId: 'ck_a',
      requestId: 'fr_1',
      idempotencyKey: 'idem_accept',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/inbound',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      customer_id: 'ck_z',
      inbound_event_id: 'friend-request:fr_1:accepted:idem_accept',
      message_type: 'product_notification',
      product_notification: {
        request_id: 'fr_1',
        request_type: 'friend_request',
        actor_account_id: 'ck_a',
        kind: 'friend_request_accepted',
      },
    });
    expect(db.productNotification.updateMany).toHaveBeenCalledWith({
      where: { id: 'pn_1', status: { in: ['pending_delivery', 'failed'] } },
      data: {
        status: 'delivered',
        deliveredAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('delivers accepted friend-request notifications only after the accept transaction commits', async () => {
    const events: string[] = [];
    const tx = {
      friendRequest: {
        updateMany: vi.fn(),
        findUnique: vi.fn(),
      },
      friendship: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      accountBlock: {
        findFirst: vi.fn(),
      },
      productNotification: {
        create: vi.fn(() => {
          throw new Error('notification_in_transaction');
        }),
      },
    };
    db.$transaction.mockImplementationOnce(async (fn) => {
      events.push('transaction:start');
      const result = await fn(tx as never);
      events.push('transaction:commit');
      return result;
    });
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      events.push('bridge:fetch');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    tx.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_z',
      targetAccountId: 'ck_a',
      status: 'accepted',
    });
    tx.accountBlock.findFirst.mockResolvedValueOnce(null);
    tx.friendship.create.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_z',
      status: 'active',
    });
    db.productNotification.create.mockImplementationOnce(async ({ data }) => {
      events.push('notification:create');
      return {
        id: 'pn_1',
        recipientAccountId: data.recipientAccountId,
        idempotencyKey: data.idempotencyKey,
        kind: data.kind,
        payload: data.payload,
        status: 'pending_delivery',
      };
    });
    db.productNotification.updateMany.mockImplementationOnce(async () => {
      events.push('notification:delivered');
      return { count: 1 };
    });

    const result = await acceptFriendRequest(db as never, {
      actorAccountId: 'ck_a',
      requestId: 'fr_1',
      idempotencyKey: 'idem_accept',
    });

    expect(result).toMatchObject({ id: 'fr_1', status: 'accepted' });
    expect(tx.productNotification.create).not.toHaveBeenCalled();
    expect(events).toEqual([
      'transaction:start',
      'transaction:commit',
      'notification:create',
      'bridge:fetch',
      'notification:delivered',
    ]);
  });

  it('rejecting a pending request marks it rejected without creating a friendship', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await rejectFriendRequest(db as never, {
      actorAccountId: 'ck_a',
      requestId: 'fr_1',
      idempotencyKey: 'idem_reject',
    });

    expect(result).toEqual({ id: 'fr_1', status: 'rejected' });
    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.friendRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'fr_1', status: 'pending', targetAccountId: 'ck_a' },
      data: { status: 'rejected', resolvedAt: expect.any(Date) },
    });
  });

  it('lists active friendships with account profile data for name resolution', async () => {
    db.friendship.findMany.mockResolvedValueOnce([
      {
        id: 'fs_1',
        accountAId: 'ck_a',
        accountBId: 'ck_b',
        status: 'active',
        accountA: { id: 'ck_a', displayName: 'Alice', avatarUrl: null },
        accountB: { id: 'ck_b', displayName: 'Bob', avatarUrl: 'https://img.example/b.png' },
      },
    ]);

    await expect(listFriends(db as never, { accountId: 'ck_a' })).resolves.toEqual([
      {
        id: 'fs_1',
        accountAId: 'ck_a',
        accountBId: 'ck_b',
        status: 'active',
        accountA: { id: 'ck_a', displayName: 'Alice', avatarUrl: null },
        accountB: { id: 'ck_b', displayName: 'Bob', avatarUrl: 'https://img.example/b.png' },
      },
    ]);
    expect(db.friendship.findMany).toHaveBeenCalledWith({
      where: {
        status: 'active',
        OR: [{ accountAId: 'ck_a' }, { accountBId: 'ck_a' }],
      },
      include: {
        accountA: { select: { id: true, displayName: true, avatarUrl: true } },
        accountB: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('canceling a pending request requires the requester actor and does not create a friendship', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await cancelFriendRequest(db as never, {
      actorAccountId: 'ck_b',
      requestId: 'fr_1',
      idempotencyKey: 'idem_cancel',
    });

    expect(result).toEqual({ id: 'fr_1', status: 'cancelled' });
    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.friendRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'fr_1', status: 'pending', requesterAccountId: 'ck_b' },
      data: { status: 'cancelled', resolvedAt: expect.any(Date) },
    });
  });

  it('does not leak ownership when the actor does not own a request transition', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });
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
    ).rejects.toThrow('friend_request_not_found');

    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.friendRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'fr_1', status: 'pending', targetAccountId: 'ck_b' },
      data: { status: 'accepted', resolvedAt: expect.any(Date) },
    });
  });

  it('returns a stable reject retry result after the authorized actor already rejected it', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'rejected',
    });

    await expect(
      rejectFriendRequest(db as never, {
        actorAccountId: 'ck_a',
        requestId: 'fr_1',
        idempotencyKey: 'idem_reject_retry',
      }),
    ).resolves.toEqual({ id: 'fr_1', status: 'rejected' });
  });

  it('returns a stable cancel retry result after the authorized requester already cancelled it', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'cancelled',
    });

    await expect(
      cancelFriendRequest(db as never, {
        actorAccountId: 'ck_b',
        requestId: 'fr_1',
        idempotencyKey: 'idem_cancel_retry',
      }),
    ).resolves.toEqual({ id: 'fr_1', status: 'cancelled' });
  });

  it('does not create friendship or notification when a concurrent transition already rejected the request', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_b',
      targetAccountId: 'ck_a',
      status: 'rejected',
    });

    await expect(
      acceptFriendRequest(db as never, {
        actorAccountId: 'ck_a',
        requestId: 'fr_1',
        idempotencyKey: 'idem_accept_lost',
      }),
    ).rejects.toThrow('friend_request_not_found');

    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.productNotification.create).not.toHaveBeenCalled();
  });

  it('replays accepted side effects when an authorized accept retry sees an accepted request', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_z',
      targetAccountId: 'ck_a',
      status: 'accepted',
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_z',
      status: 'active',
    });

    await expect(
      acceptFriendRequest(db as never, {
        actorAccountId: 'ck_a',
        requestId: 'fr_1',
        idempotencyKey: 'idem_accept_retry',
      }),
    ).resolves.toMatchObject({ id: 'fr_1', status: 'accepted' });

    expect(db.friendship.findFirst).toHaveBeenCalledWith({
      where: { accountAId: 'ck_a', accountBId: 'ck_z', status: 'active' },
    });
    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.productNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'friend-request:fr_1:accepted:idem_accept_retry',
        kind: 'friend_request_accepted',
      }),
    });
  });

  it('does not resurrect a removed friendship on accepted request retry', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_z',
      targetAccountId: 'ck_a',
      status: 'accepted',
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendship.findFirst.mockResolvedValueOnce(null);

    await expect(
      acceptFriendRequest(db as never, {
        actorAccountId: 'ck_a',
        requestId: 'fr_1',
        idempotencyKey: 'idem_accept_removed_retry',
      }),
    ).rejects.toThrow('friendship_not_found');

    expect(db.friendship.findFirst).toHaveBeenCalledWith({
      where: { accountAId: 'ck_a', accountBId: 'ck_z', status: 'active' },
    });
    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.productNotification.create).not.toHaveBeenCalled();
  });

  it('fails closed when accepting a stale pending request after the target blocked the requester', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.findUnique.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'ck_blocked',
      targetAccountId: 'ck_target',
      status: 'accepted',
    });
    db.accountBlock.findFirst.mockResolvedValueOnce({ id: 'blk_1' });

    await expect(
      acceptFriendRequest(db as never, {
        actorAccountId: 'ck_target',
        requestId: 'fr_1',
        idempotencyKey: 'idem_accept_blocked',
      }),
    ).rejects.toThrow('friend_request_blocked');

    expect(db.friendship.create).not.toHaveBeenCalled();
    expect(db.productNotification.create).not.toHaveBeenCalled();
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
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: null,
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    await blockAccount(db as never, {
      blockerAccountId: 'ck_b',
      blockedAccountId: 'ck_a',
    });

    expect(db.accountBlock.create).toHaveBeenCalledWith({
      data: { blockerAccountId: 'ck_b', blockedAccountId: 'ck_a' },
    });
    expect(db.friendRequest.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        OR: [
          { requesterAccountId: 'ck_a', targetAccountId: 'ck_b' },
          { requesterAccountId: 'ck_b', targetAccountId: 'ck_a' },
        ],
      },
      data: { status: 'cancelled', resolvedAt: expect.any(Date) },
    });
    expect(db.friendship.findFirst).toHaveBeenCalledWith({
      where: { accountAId: 'ck_a', accountBId: 'ck_b', status: 'active' },
    });
    expect(db.friendship.updateMany).toHaveBeenCalledWith({
      where: { id: 'fs_1', status: 'active' },
      data: { status: 'removed', removedAt: expect.any(Date) },
    });
    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
  });

  it('blocking an account cancels requester projections after invalidating pending shared reminders', async () => {
    db.accountBlock.create.mockResolvedValueOnce({ id: 'blk_1' });
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: 'rem_req_1',
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();

    await blockAccount(db as never, reminderRuntime, {
      blockerAccountId: 'ck_b',
      blockedAccountId: 'ck_a',
    });

    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_a',
      reminderId: 'rem_req_1',
    });
    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
  });

  it('blocking an account invalidates pending shared reminders before cancelling requester projections', async () => {
    db.accountBlock.create.mockResolvedValueOnce({ id: 'blk_1' });
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: 'rem_req_1',
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();

    await blockAccount(db as never, reminderRuntime, {
      blockerAccountId: 'ck_b',
      blockedAccountId: 'ck_a',
    });

    expect(db.sharedReminderRequest.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      reminderRuntime.cancelRuntimeReminder.mock.invocationCallOrder[0],
    );
  });

  it('blocking an account does not cancel requester projection when per-request invalidation loses a race', async () => {
    db.accountBlock.create.mockResolvedValueOnce({ id: 'blk_1' });
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: 'rem_req_1',
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();

    await blockAccount(db as never, reminderRuntime, {
      blockerAccountId: 'ck_b',
      blockedAccountId: 'ck_a',
    });

    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
    expect(reminderRuntime.cancelRuntimeReminder).not.toHaveBeenCalled();
  });

  it('treats duplicate block creation as a successful retry', async () => {
    db.accountBlock.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    db.friendship.findFirst.mockResolvedValueOnce(null);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      blockAccount(db as never, {
        blockerAccountId: 'ck_b',
        blockedAccountId: 'ck_a',
      }),
    ).resolves.toEqual({ blockedAccountId: 'ck_a', blockerAccountId: 'ck_b' });
  });

  it('cleans up invalidated requester projection on duplicate block retry with no active friendship', async () => {
    db.friendRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    db.accountBlock.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    db.friendship.findFirst.mockResolvedValueOnce(null);
    db.sharedReminderRequest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: 'rem_req_invalidated',
          status: 'invalidated',
        },
      ]);
    const reminderRuntime = fakeReminderRuntime();

    await expect(
      blockAccount(db as never, reminderRuntime, {
        blockerAccountId: 'ck_b',
        blockedAccountId: 'ck_a',
      }),
    ).resolves.toEqual({ blockedAccountId: 'ck_a', blockerAccountId: 'ck_b' });

    expect(db.sharedReminderRequest.findMany).toHaveBeenCalledWith({
      where: {
        status: 'invalidated',
        OR: [
          { requesterAccountId: 'ck_b', inviteeAccountId: 'ck_a' },
          { requesterAccountId: 'ck_a', inviteeAccountId: 'ck_b' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_a',
      reminderId: 'rem_req_invalidated',
    });
  });

  it('removing a friendship invalidates pending shared reminders but not accepted shared reminders', async () => {
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: null,
        status: 'pending_invitee_confirmation',
      },
    ]);
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
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
  });

  it('removing a friendship cancels requester projection resolved from projection row after invalidating', async () => {
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: null,
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.reminderProjection.findFirst.mockResolvedValueOnce({
      id: 'rp_req_1',
      sharedReminderRequestId: 'srr_1',
      ownerAccountId: 'ck_a',
      runtimeReminderId: 'rem_req_from_projection',
      role: 'requester',
    });
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();

    await removeFriendship(db as never, reminderRuntime, {
      actorAccountId: 'ck_b',
      friendshipId: 'fs_1',
    });

    expect(db.reminderProjection.findFirst).toHaveBeenCalledWith({
      where: { sharedReminderRequestId: 'srr_1', role: 'requester' },
    });
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_a',
      reminderId: 'rem_req_from_projection',
    });
    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
  });

  it('removing a friendship invalidates pending shared reminders before cancelling requester projections', async () => {
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: 'rem_req_1',
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();

    await removeFriendship(db as never, reminderRuntime, {
      actorAccountId: 'ck_b',
      friendshipId: 'fs_1',
    });

    expect(db.sharedReminderRequest.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      reminderRuntime.cancelRuntimeReminder.mock.invocationCallOrder[0],
    );
  });

  it('removing a friendship does not cancel requester projection when per-request invalidation loses a race', async () => {
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: 'rem_req_1',
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const reminderRuntime = fakeReminderRuntime();

    await removeFriendship(db as never, reminderRuntime, {
      actorAccountId: 'ck_b',
      friendshipId: 'fs_1',
    });

    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
    expect(reminderRuntime.cancelRuntimeReminder).not.toHaveBeenCalled();
  });

  it('keeps invalidated pending shared reminders when requester projection cancellation fails', async () => {
    db.friendship.findFirst.mockResolvedValueOnce({
      id: 'fs_1',
      accountAId: 'ck_a',
      accountBId: 'ck_b',
      status: 'active',
    });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany.mockResolvedValueOnce([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_a',
        inviteeAccountId: 'ck_b',
        requesterReminderId: 'rem_req_1',
        status: 'pending_invitee_confirmation',
      },
    ]);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: false, error: 'reminder_bridge_transport_failed' },
    });

    await expect(
      removeFriendship(db as never, reminderRuntime, {
        actorAccountId: 'ck_b',
        friendshipId: 'fs_1',
      }),
    ).rejects.toThrow('reminder_projection_failed');

    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
      data: { status: 'invalidated', resolvedAt: expect.any(Date) },
    });
    expect(db.sharedReminderRequest.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      reminderRuntime.cancelRuntimeReminder.mock.invocationCallOrder[0],
    );
  });

  it('cleans up invalidated requester projection on removed friendship retry after cancellation failure', async () => {
    db.friendship.findFirst
      .mockResolvedValueOnce({
        id: 'fs_1',
        accountAId: 'ck_a',
        accountBId: 'ck_b',
        status: 'active',
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'fs_1',
        accountAId: 'ck_a',
        accountBId: 'ck_b',
        status: 'removed',
      });
    db.friendship.updateMany.mockResolvedValueOnce({ count: 1 });
    db.sharedReminderRequest.findMany
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: 'rem_req_1',
          status: 'pending_invitee_confirmation',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: 'rem_req_1',
          status: 'invalidated',
        },
      ]);
    db.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();
    reminderRuntime.cancelRuntimeReminder
      .mockResolvedValueOnce({ ok: false, error: 'reminder_bridge_transport_failed' })
      .mockResolvedValueOnce({ ok: true, data: { id: 'rem_req_1' } });

    await expect(
      removeFriendship(db as never, reminderRuntime, {
        actorAccountId: 'ck_b',
        friendshipId: 'fs_1',
      }),
    ).rejects.toThrow('reminder_projection_failed');

    await expect(
      removeFriendship(db as never, reminderRuntime, {
        actorAccountId: 'ck_b',
        friendshipId: 'fs_1',
      }),
    ).resolves.toEqual({ id: 'fs_1', status: 'removed' });

    expect(db.sharedReminderRequest.findMany).toHaveBeenLastCalledWith({
      where: { friendshipId: 'fs_1', status: 'invalidated' },
      orderBy: { createdAt: 'asc' },
    });
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenNthCalledWith(2, {
      customerId: 'ck_a',
      reminderId: 'rem_req_1',
    });
  });

  it('marks removed-friendship invalidated cleanup complete after successful requester projection cancellation', async () => {
    db.friendship.findFirst
      .mockResolvedValueOnce({
        id: 'fs_1',
        accountAId: 'ck_a',
        accountBId: 'ck_b',
        status: 'removed',
      })
      .mockResolvedValueOnce({
        id: 'fs_1',
        accountAId: 'ck_a',
        accountBId: 'ck_b',
        status: 'removed',
      });
    db.sharedReminderRequest.findMany
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: 'rem_req_1',
          status: 'invalidated',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: null,
          status: 'invalidated',
        },
      ]);
    db.sharedReminderRequest.updateMany.mockResolvedValue({ count: 1 });
    db.reminderProjection.deleteMany.mockResolvedValue({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();

    await expect(
      removeFriendship(db as never, reminderRuntime, {
        actorAccountId: 'ck_b',
        friendshipId: 'fs_1',
      }),
    ).resolves.toEqual({ id: 'fs_1', status: 'removed' });
    await expect(
      removeFriendship(db as never, reminderRuntime, {
        actorAccountId: 'ck_b',
        friendshipId: 'fs_1',
      }),
    ).resolves.toEqual({ id: 'fs_1', status: 'removed' });

    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.reminderProjection.deleteMany).toHaveBeenCalledWith({
      where: {
        sharedReminderRequestId: 'srr_1',
        role: 'requester',
        runtimeReminderId: 'rem_req_1',
      },
    });
    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'invalidated', requesterReminderId: 'rem_req_1' },
      data: { requesterReminderId: null },
    });
  });

  it('marks duplicate-block invalidated cleanup complete after failure then success', async () => {
    db.friendRequest.updateMany.mockResolvedValue({ count: 0 });
    db.accountBlock.create
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    db.friendship.findFirst.mockResolvedValue(null);
    db.sharedReminderRequest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: 'rem_req_1',
          status: 'invalidated',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: 'rem_req_1',
          status: 'invalidated',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'srr_1',
          requesterAccountId: 'ck_a',
          inviteeAccountId: 'ck_b',
          requesterReminderId: null,
          status: 'invalidated',
        },
      ]);
    db.sharedReminderRequest.updateMany.mockResolvedValue({ count: 1 });
    db.reminderProjection.deleteMany.mockResolvedValue({ count: 1 });
    const reminderRuntime = fakeReminderRuntime();
    reminderRuntime.cancelRuntimeReminder
      .mockResolvedValueOnce({ ok: false, error: 'reminder_bridge_transport_failed' })
      .mockResolvedValueOnce({ ok: true, data: { id: 'rem_req_1' } });

    await expect(
      blockAccount(db as never, reminderRuntime, {
        blockerAccountId: 'ck_b',
        blockedAccountId: 'ck_a',
      }),
    ).rejects.toThrow('reminder_projection_failed');
    await expect(
      blockAccount(db as never, reminderRuntime, {
        blockerAccountId: 'ck_b',
        blockedAccountId: 'ck_a',
      }),
    ).resolves.toEqual({ blockerAccountId: 'ck_b', blockedAccountId: 'ck_a' });
    await expect(
      blockAccount(db as never, reminderRuntime, {
        blockerAccountId: 'ck_b',
        blockedAccountId: 'ck_a',
      }),
    ).resolves.toEqual({ blockerAccountId: 'ck_b', blockedAccountId: 'ck_a' });

    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledTimes(2);
    expect(db.reminderProjection.deleteMany).toHaveBeenCalledWith({
      where: {
        sharedReminderRequestId: 'srr_1',
        role: 'requester',
        runtimeReminderId: 'rem_req_1',
      },
    });
    expect(db.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'invalidated', requesterReminderId: 'rem_req_1' },
      data: { requesterReminderId: null },
    });
  });
});
