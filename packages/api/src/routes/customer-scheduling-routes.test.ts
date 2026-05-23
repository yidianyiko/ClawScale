import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  getCustomerSession: vi.fn(),
}));

const scheduling = vi.hoisted(() => ({
  getOrCreateActiveUserLink: vi.fn(),
  resetUserLink: vi.fn(),
  disableUserLink: vi.fn(),
}));

const friendships = vi.hoisted(() => ({
  listFriendRequests: vi.fn(),
  acceptFriendRequest: vi.fn(),
  rejectFriendRequest: vi.fn(),
  cancelFriendRequest: vi.fn(),
  listFriends: vi.fn(),
  removeFriendship: vi.fn(),
  blockAccount: vi.fn(),
  unblockAccount: vi.fn(),
}));

const sharedReminders = vi.hoisted(() => ({
  createSharedReminder: vi.fn(),
  listPendingSharedReminders: vi.fn(),
  acceptSharedReminder: vi.fn(),
  rejectSharedReminder: vi.fn(),
  cancelSharedReminder: vi.fn(),
}));

const reminderRuntime = vi.hoisted(() => ({
  createRuntimeReminder: vi.fn(),
  cancelRuntimeReminder: vi.fn(),
}));

const db = vi.hoisted(() => ({}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/customer-auth.js', () => auth);
vi.mock('../scheduling/user-link-service.js', () => ({
  getOrCreateActiveUserLink: scheduling.getOrCreateActiveUserLink,
  resetUserLink: scheduling.resetUserLink,
  disableUserLink: scheduling.disableUserLink,
}));
vi.mock('../scheduling/friendship-service.js', () => friendships);
vi.mock('../scheduling/shared-reminder-service.js', () => sharedReminders);
vi.mock('../lib/reminder-runtime-client.js', () => reminderRuntime);

import { customerSchedulingRouter } from './customer-scheduling-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/customer/scheduling', customerSchedulingRouter);
  return app;
}

describe('customer scheduling routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyCustomerToken.mockReturnValue({
      sub: 'ck_123',
      identityId: 'idt_123',
      tokenType: 'access',
    });
    auth.getCustomerSession.mockResolvedValue({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
    scheduling.getOrCreateActiveUserLink.mockResolvedValue({
      code: 'AbCdEfGhIjK_',
      status: 'active',
    });
    scheduling.resetUserLink.mockResolvedValue({
      code: 'ResetCode123',
      status: 'active',
    });
    scheduling.disableUserLink.mockResolvedValue({ count: 1 });
    friendships.listFriendRequests.mockResolvedValue([
      {
        id: 'fr_1',
        requesterAccountId: 'ck_other',
        targetAccountId: 'ck_123',
        linkSessionId: 'ls_internal',
        idempotencyKey: 'idem_internal',
        status: 'pending',
        createdAt: new Date('2026-05-22T00:00:00.000Z'),
        updatedAt: new Date('2026-05-22T00:00:00.000Z'),
      },
    ]);
    friendships.acceptFriendRequest.mockResolvedValue({
      id: 'fr_1',
      requesterAccountId: 'ck_other',
      targetAccountId: 'ck_123',
      linkSessionId: 'ls_internal',
      idempotencyKey: 'idem_internal',
      status: 'accepted',
      resolvedAt: new Date('2026-05-22T00:00:00.000Z'),
    });
    friendships.rejectFriendRequest.mockResolvedValue({ id: 'fr_1', status: 'rejected', idempotencyKey: 'idem_internal' });
    friendships.cancelFriendRequest.mockResolvedValue({
      id: 'fr_1',
      status: 'cancelled',
      linkSessionId: 'ls_internal',
    });
    friendships.listFriends.mockResolvedValue([
      {
        id: 'fs_1',
        accountAId: 'ck_123',
        accountBId: 'ck_other',
        friendRequestId: 'fr_1',
        status: 'active',
        accountA: { id: 'ck_123', displayName: 'Alice', avatarUrl: null },
        accountB: { id: 'ck_other', displayName: 'Bob', avatarUrl: 'https://img.example/b.png' },
        createdAt: new Date('2026-05-22T00:00:00.000Z'),
      },
    ]);
    friendships.removeFriendship.mockResolvedValue({
      id: 'fs_1',
      status: 'removed',
      accountAId: 'ck_123',
      accountBId: 'ck_other',
    });
    friendships.blockAccount.mockResolvedValue({ blockerAccountId: 'ck_123', blockedAccountId: 'ck_other' });
    friendships.unblockAccount.mockResolvedValue({ blockerAccountId: 'ck_123', blockedAccountId: 'ck_other' });
    sharedReminders.createSharedReminder.mockResolvedValue({
      id: 'srr_1',
      requesterAccountId: 'ck_123',
      inviteeAccountId: 'ck_other',
      title: 'meeting',
      fireAt: new Date('2026-05-23T07:00:00.000Z'),
      timezone: 'Asia/Shanghai',
      status: 'pending_invitee_confirmation',
    });
    sharedReminders.listPendingSharedReminders.mockResolvedValue([
      {
        id: 'srr_1',
        requesterAccountId: 'ck_other',
        inviteeAccountId: 'ck_123',
        title: 'meeting',
        fireAt: new Date('2026-05-23T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'pending_invitee_confirmation',
      },
    ]);
    sharedReminders.acceptSharedReminder.mockResolvedValue({ id: 'srr_1', status: 'accepted' });
    sharedReminders.rejectSharedReminder.mockResolvedValue({ id: 'srr_1', status: 'rejected' });
    sharedReminders.cancelSharedReminder.mockResolvedValue({ id: 'srr_1', status: 'cancelled' });
    reminderRuntime.createRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem_1' } });
    reminderRuntime.cancelRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem_1' } });
  });

  it('requires customer auth before returning a user link', async () => {
    const res = await createApp().request('/api/customer/scheduling/user-link');

    expect(res.status).toBe(401);
    expect(auth.verifyCustomerToken).not.toHaveBeenCalled();
    expect(scheduling.getOrCreateActiveUserLink).not.toHaveBeenCalled();
  });

  it('uses the authenticated customer id for user-link ownership', async () => {
    const res = await createApp().request('/api/customer/scheduling/user-link', {
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(auth.verifyCustomerToken).toHaveBeenCalledWith('customer-token');
    expect(scheduling.getOrCreateActiveUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_123',
    });
  });

  it('uses the authenticated customer id for user-link reset', async () => {
    const res = await createApp().request('/api/customer/scheduling/user-link/reset', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(scheduling.resetUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_123',
    });
  });

  it('uses the authenticated customer id for user-link disable', async () => {
    const res = await createApp().request('/api/customer/scheduling/user-link/disable', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(scheduling.disableUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_123',
    });
  });

  it('lists friend requests for the authenticated customer', async () => {
    const res = await createApp().request('/api/customer/scheduling/friend-requests', {
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(friendships.listFriendRequests).toHaveBeenCalledWith(db as never, {
      accountId: 'ck_123',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: [{ id: 'fr_1', status: 'pending', direction: 'incoming', counterpartAccountId: 'ck_other' }],
    });
  });

  it('does not expose internal friend request fields in customer responses', async () => {
    const listRes = await createApp().request('/api/customer/scheduling/friend-requests', {
      headers: { authorization: 'Bearer customer-token' },
    });
    const actionRes = await createApp().request('/api/customer/scheduling/friend-requests/fr_1/accept', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token' },
    });

    const listBody = await listRes.json();
    const actionBody = await actionRes.json();

    expect(listBody.data[0]).toEqual({
      id: 'fr_1',
      status: 'pending',
      direction: 'incoming',
      counterpartAccountId: 'ck_other',
    });
    expect(actionBody.data).toEqual({ id: 'fr_1', status: 'accepted' });
    expect(listBody.data[0]).not.toHaveProperty('linkSessionId');
    expect(listBody.data[0]).not.toHaveProperty('idempotencyKey');
    expect(listBody.data[0]).not.toHaveProperty('createdAt');
    expect(actionBody.data).not.toHaveProperty('requesterAccountId');
    expect(actionBody.data).not.toHaveProperty('targetAccountId');
    expect(actionBody.data).not.toHaveProperty('resolvedAt');
  });

  it('accepts, rejects, and cancels friend requests as the authenticated customer', async () => {
    for (const [action, service] of [
      ['accept', friendships.acceptFriendRequest],
      ['reject', friendships.rejectFriendRequest],
      ['cancel', friendships.cancelFriendRequest],
    ] as const) {
      const res = await createApp().request(`/api/customer/scheduling/friend-requests/fr_1/${action}`, {
        method: 'POST',
        headers: { authorization: 'Bearer customer-token' },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        ok: true,
        data: { id: 'fr_1', status: action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled' },
      });
      expect(service).toHaveBeenCalledWith(db as never, {
        actorAccountId: 'ck_123',
        requestId: 'fr_1',
        idempotencyKey: `${action}:ck_123:fr_1`,
      });
    }
  });

  it('lists friends and removes friendship as the authenticated customer', async () => {
    const listRes = await createApp().request('/api/customer/scheduling/friends', {
      headers: { authorization: 'Bearer customer-token' },
    });
    const deleteRes = await createApp().request('/api/customer/scheduling/friends/fs_1', {
      method: 'DELETE',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(listRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
    await expect(listRes.json()).resolves.toEqual({
      ok: true,
      data: [
        {
          id: 'fs_1',
          status: 'active',
          counterpartAccountId: 'ck_other',
          counterpartProfile: {
            displayName: 'Bob',
            avatarUrl: 'https://img.example/b.png',
          },
        },
      ],
    });
    await expect(deleteRes.json()).resolves.toEqual({
      ok: true,
      data: { id: 'fs_1', status: 'removed' },
    });
    expect(friendships.listFriends).toHaveBeenCalledWith(db as never, {
      accountId: 'ck_123',
    });
    expect(friendships.removeFriendship).toHaveBeenCalledWith(
      db as never,
      { cancelRuntimeReminder: reminderRuntime.cancelRuntimeReminder },
      {
        actorAccountId: 'ck_123',
        friendshipId: 'fs_1',
      },
    );
  });

  it('uses the authenticated customer id for block ownership and ignores body actor ids', async () => {
    const res = await createApp().request('/api/customer/scheduling/blocks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ blockerAccountId: 'ck_attacker', blockedAccountId: 'ck_other' }),
    });

    expect(res.status).toBe(200);
    expect(friendships.blockAccount).toHaveBeenCalledWith(
      db as never,
      { cancelRuntimeReminder: reminderRuntime.cancelRuntimeReminder },
      {
        blockerAccountId: 'ck_123',
        blockedAccountId: 'ck_other',
      },
    );
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { blockedAccountId: 'ck_other' },
    });
  });

  it('unblocks as the authenticated customer', async () => {
    const res = await createApp().request('/api/customer/scheduling/blocks/ck_other', {
      method: 'DELETE',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(friendships.unblockAccount).toHaveBeenCalledWith(db as never, {
      blockerAccountId: 'ck_123',
      blockedAccountId: 'ck_other',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { blockedAccountId: 'ck_other' },
    });
  });

  it('creates and lists shared reminder requests as the authenticated customer', async () => {
    const createRes = await createApp().request('/api/customer/scheduling/shared-reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        requesterAccountId: 'ck_attacker',
        inviteeAccountId: 'ck_other',
        title: 'meeting',
        fireAt: '2026-05-23T07:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'idem_shared_create',
      }),
    });
    const listRes = await createApp().request('/api/customer/scheduling/shared-reminders/pending', {
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(createRes.status).toBe(201);
    expect(listRes.status).toBe(200);
    expect(sharedReminders.createSharedReminder).toHaveBeenCalledWith(
      db as never,
      {
        createRuntimeReminder: reminderRuntime.createRuntimeReminder,
        cancelRuntimeReminder: reminderRuntime.cancelRuntimeReminder,
      },
      {
        requesterAccountId: 'ck_123',
        inviteeAccountId: 'ck_other',
        title: 'meeting',
        fireAt: '2026-05-23T07:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'idem_shared_create',
      },
    );
    expect(sharedReminders.listPendingSharedReminders).toHaveBeenCalledWith(db as never, {
      inviteeAccountId: 'ck_123',
    });
    await expect(createRes.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        counterpartAccountId: 'ck_other',
        title: 'meeting',
        fireAt: '2026-05-23T07:00:00.000Z',
        timezone: 'Asia/Shanghai',
      },
    });
    await expect(listRes.json()).resolves.toEqual({
      ok: true,
      data: [
        {
          id: 'srr_1',
          status: 'pending_invitee_confirmation',
          counterpartAccountId: 'ck_other',
          title: 'meeting',
          fireAt: '2026-05-23T07:00:00.000Z',
          timezone: 'Asia/Shanghai',
        },
      ],
    });
  });

  it('accepts, rejects, and cancels shared reminder requests as the authenticated customer', async () => {
    for (const [action, service, status] of [
      ['accept', sharedReminders.acceptSharedReminder, 'accepted'],
      ['reject', sharedReminders.rejectSharedReminder, 'rejected'],
      ['cancel', sharedReminders.cancelSharedReminder, 'cancelled'],
    ] as const) {
      const res = await createApp().request(`/api/customer/scheduling/shared-reminders/srr_1/${action}`, {
        method: 'POST',
        headers: { authorization: 'Bearer customer-token' },
      });

      expect(res.status).toBe(200);
      expect(service).toHaveBeenCalledWith(
        db as never,
        {
          createRuntimeReminder: reminderRuntime.createRuntimeReminder,
          cancelRuntimeReminder: reminderRuntime.cancelRuntimeReminder,
        },
        {
          actorAccountId: 'ck_123',
          requestId: 'srr_1',
          now: expect.any(Date),
          idempotencyKey: `${action}:ck_123:srr_1`,
        },
      );
      await expect(res.json()).resolves.toEqual({
        ok: true,
        data: { id: 'srr_1', status },
      });
    }
  });

  it('returns a stable JSON error when a friendship service rejects', async () => {
    friendships.acceptFriendRequest.mockRejectedValueOnce(new Error('not_allowed'));

    const res = await createApp().request('/api/customer/scheduling/friend-requests/fr_1/accept', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'not_allowed' });
  });

  it('preserves the friend request blocked error for accept after block', async () => {
    friendships.acceptFriendRequest.mockRejectedValueOnce(new Error('friend_request_blocked'));

    const res = await createApp().request('/api/customer/scheduling/friend-requests/fr_1/accept', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'friend_request_blocked' });
  });

});
