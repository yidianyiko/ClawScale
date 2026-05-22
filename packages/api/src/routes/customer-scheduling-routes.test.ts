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

const db = vi.hoisted(() => ({}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/customer-auth.js', () => auth);
vi.mock('../scheduling/user-link-service.js', () => ({
  getOrCreateActiveUserLink: scheduling.getOrCreateActiveUserLink,
  resetUserLink: scheduling.resetUserLink,
  disableUserLink: scheduling.disableUserLink,
}));
vi.mock('../scheduling/friendship-service.js', () => friendships);

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
      { id: 'fr_1', requesterAccountId: 'ck_other', targetAccountId: 'ck_123', status: 'pending' },
    ]);
    friendships.acceptFriendRequest.mockResolvedValue({ id: 'fr_1', status: 'accepted' });
    friendships.rejectFriendRequest.mockResolvedValue({ id: 'fr_1', status: 'rejected' });
    friendships.cancelFriendRequest.mockResolvedValue({ id: 'fr_1', status: 'cancelled' });
    friendships.listFriends.mockResolvedValue([{ id: 'fs_1', accountAId: 'ck_123', accountBId: 'ck_other' }]);
    friendships.removeFriendship.mockResolvedValue({ id: 'fs_1', status: 'removed' });
    friendships.blockAccount.mockResolvedValue({ blockerAccountId: 'ck_123', blockedAccountId: 'ck_other' });
    friendships.unblockAccount.mockResolvedValue({ blockerAccountId: 'ck_123', blockedAccountId: 'ck_other' });
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
      data: [{ id: 'fr_1', requesterAccountId: 'ck_other', targetAccountId: 'ck_123', status: 'pending' }],
    });
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
    expect(friendships.listFriends).toHaveBeenCalledWith(db as never, {
      accountId: 'ck_123',
    });
    expect(friendships.removeFriendship).toHaveBeenCalledWith(db as never, {
      actorAccountId: 'ck_123',
      friendshipId: 'fs_1',
    });
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
    expect(friendships.blockAccount).toHaveBeenCalledWith(db as never, {
      blockerAccountId: 'ck_123',
      blockedAccountId: 'ck_other',
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

  it.each([
    ['POST', '/bookable-windows/preview'],
    ['POST', '/bookable-windows/confirm'],
    ['GET', '/bookable-windows'],
    ['POST', '/appointments'],
    ['GET', '/appointments/pending'],
    ['POST', '/appointments/apt_1/confirm'],
    ['POST', '/appointments/apt_1/reject'],
    ['POST', '/appointments/apt_1/cancel'],
    ['POST', '/service-links/ck_other/block'],
    ['POST', '/service-links/ck_other/unblock'],
    ['DELETE', '/service-links/ck_other'],
  ])('fails closed for retired %s %s', async (method, path) => {
    const res = await createApp().request(`/api/customer/scheduling${path}`, {
      method,
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify({ preview: {}, idempotencyKey: 'idem_1' }),
    });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'appointment_scheduling_retired',
    });
  });
});
