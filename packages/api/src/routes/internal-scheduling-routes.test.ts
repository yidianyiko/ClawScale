import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const notifications = vi.hoisted(() => ({
  deliverPendingProductNotifications: vi.fn(),
}));

const reminderRuntime = vi.hoisted(() => ({
  createRuntimeReminder: vi.fn(),
  cancelRuntimeReminder: vi.fn(),
}));

const db = vi.hoisted(() => ({}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../scheduling/user-link-service.js', () => ({
  getOrCreateActiveUserLink: scheduling.getOrCreateActiveUserLink,
  resetUserLink: scheduling.resetUserLink,
  disableUserLink: scheduling.disableUserLink,
}));
vi.mock('../scheduling/friendship-service.js', () => friendships);
vi.mock('../scheduling/shared-reminder-service.js', () => sharedReminders);
vi.mock('../scheduling/notification-service.js', () => notifications);
vi.mock('../lib/reminder-runtime-client.js', () => reminderRuntime);

import { internalSchedulingRouter } from './internal-scheduling-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/internal/scheduling', internalSchedulingRouter);
  return app;
}

describe('internal scheduling routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAWSCALE_IDENTITY_API_KEY = 'internal-key';
    scheduling.getOrCreateActiveUserLink.mockResolvedValue({ code: 'AbCdEfGhIjK_' });
    scheduling.resetUserLink.mockResolvedValue({ code: 'ResetCode123' });
    scheduling.disableUserLink.mockResolvedValue({ count: 1 });
    friendships.listFriendRequests.mockResolvedValue([{ id: 'fr_1', status: 'pending' }]);
    friendships.acceptFriendRequest.mockResolvedValue({ id: 'fr_1', status: 'accepted' });
    friendships.rejectFriendRequest.mockResolvedValue({ id: 'fr_1', status: 'rejected' });
    friendships.cancelFriendRequest.mockResolvedValue({ id: 'fr_1', status: 'cancelled' });
    friendships.listFriends.mockResolvedValue([{ id: 'fs_1', status: 'active' }]);
    friendships.removeFriendship.mockResolvedValue({ id: 'fs_1', status: 'removed' });
    friendships.blockAccount.mockResolvedValue({ blockerAccountId: 'ck_provider', blockedAccountId: 'ck_other' });
    friendships.unblockAccount.mockResolvedValue({ blockerAccountId: 'ck_provider', blockedAccountId: 'ck_other' });
    sharedReminders.createSharedReminder.mockResolvedValue({ id: 'sr_1', status: 'pending_invitee_confirmation' });
    sharedReminders.listPendingSharedReminders.mockResolvedValue([{ id: 'sr_1', status: 'pending_invitee_confirmation' }]);
    sharedReminders.acceptSharedReminder.mockResolvedValue({ id: 'sr_1', status: 'accepted' });
    sharedReminders.rejectSharedReminder.mockResolvedValue({ id: 'sr_1', status: 'rejected' });
    sharedReminders.cancelSharedReminder.mockResolvedValue({ id: 'sr_1', status: 'cancelled' });
    notifications.deliverPendingProductNotifications.mockResolvedValue({ delivered: 1, failed: 0 });
    reminderRuntime.createRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem_1' } });
    reminderRuntime.cancelRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem_1' } });
  });

  it('requires the internal bearer token for tools', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/get_user_link', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expect(scheduling.getOrCreateActiveUserLink).not.toHaveBeenCalled();
  });

  it('keeps user-link tools active', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/get_user_link', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_provider',
      }),
    });

    expect(res.status).toBe(200);
    expect(scheduling.getOrCreateActiveUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
    });
  });

  it('wires active reset_user_link tool to resetUserLink', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/reset_user_link', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_provider',
      }),
    });

    expect(res.status).toBe(200);
    expect(scheduling.resetUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
    });
  });

  it('wires active disable_user_link tool to disableUserLink', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/disable_user_link', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_provider',
      }),
    });

    expect(res.status).toBe(200);
    expect(scheduling.disableUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
    });
  });

  it.each(['get_user_link', 'reset_user_link', 'disable_user_link'])(
    'rejects %s when customer_id is missing',
    async (toolName) => {
      const res = await createApp().request(`/api/internal/scheduling/tools/${toolName}`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer internal-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ customer_id: '   ' }),
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'invalid_customer_id',
      });
      expect(scheduling.getOrCreateActiveUserLink).not.toHaveBeenCalled();
      expect(scheduling.resetUserLink).not.toHaveBeenCalled();
      expect(scheduling.disableUserLink).not.toHaveBeenCalled();
    },
  );

  it('normalizes active user-link service errors', async () => {
    scheduling.resetUserLink.mockRejectedValueOnce(new Error('user_link_conflict'));

    const res = await createApp().request('/api/internal/scheduling/tools/reset_user_link', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_provider',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'user_link_conflict',
    });
  });

  it('routes friend request tools with the internal customer id as actor', async () => {
    for (const [toolName, service, expected] of [
      ['list_friend_requests', friendships.listFriendRequests, { accountId: 'ck_provider' }],
      [
        'accept_friend_request',
        friendships.acceptFriendRequest,
        { actorAccountId: 'ck_provider', requestId: 'fr_1', idempotencyKey: 'idem_1' },
      ],
      [
        'reject_friend_request',
        friendships.rejectFriendRequest,
        { actorAccountId: 'ck_provider', requestId: 'fr_1', idempotencyKey: 'idem_1' },
      ],
      [
        'cancel_friend_request',
        friendships.cancelFriendRequest,
        { actorAccountId: 'ck_provider', requestId: 'fr_1', idempotencyKey: 'idem_1' },
      ],
    ] as const) {
      const res = await createApp().request(`/api/internal/scheduling/tools/${toolName}`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer internal-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: 'ck_provider',
          request_id: 'fr_1',
          idempotency_key: 'idem_1',
        }),
      });

      expect(res.status).toBe(200);
      expect(service).toHaveBeenCalledWith(db as never, expected);
    }
  });

  it('routes friendship and block tools with cleanup runtime wiring', async () => {
    const cases = [
      {
        toolName: 'list_friends',
        service: friendships.listFriends,
        body: {},
        expected: [db as never, { accountId: 'ck_provider' }],
      },
      {
        toolName: 'remove_friendship',
        service: friendships.removeFriendship,
        body: { friendship_id: 'fs_1' },
        expected: [
          db as never,
          { cancelRuntimeReminder: reminderRuntime.cancelRuntimeReminder },
          { actorAccountId: 'ck_provider', friendshipId: 'fs_1' },
        ],
      },
      {
        toolName: 'block_account',
        service: friendships.blockAccount,
        body: { blocked_account_id: 'ck_other' },
        expected: [
          db as never,
          { cancelRuntimeReminder: reminderRuntime.cancelRuntimeReminder },
          { blockerAccountId: 'ck_provider', blockedAccountId: 'ck_other' },
        ],
      },
      {
        toolName: 'unblock_account',
        service: friendships.unblockAccount,
        body: { blocked_account_id: 'ck_other' },
        expected: [db as never, { blockerAccountId: 'ck_provider', blockedAccountId: 'ck_other' }],
      },
    ] as const;

    for (const testCase of cases) {
      const res = await createApp().request(`/api/internal/scheduling/tools/${testCase.toolName}`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer internal-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: 'ck_provider',
          ...testCase.body,
        }),
      });

      expect(res.status).toBe(200);
      expect(testCase.service).toHaveBeenCalledWith(...testCase.expected);
    }
  });

  it('routes shared reminder tools with the reminder runtime port', async () => {
    const runtimePort = {
      createRuntimeReminder: reminderRuntime.createRuntimeReminder,
      cancelRuntimeReminder: reminderRuntime.cancelRuntimeReminder,
    };
    const cases = [
      {
        toolName: 'create_shared_reminder',
        status: 201,
        service: sharedReminders.createSharedReminder,
        body: {
          invitee_account_id: 'ck_other',
          title: '吃药',
          fire_at: '2026-05-23T02:00:00.000Z',
          timezone: 'Asia/Tokyo',
          idempotency_key: 'idem_1',
        },
        expected: [
          db as never,
          runtimePort,
          {
            requesterAccountId: 'ck_provider',
            inviteeAccountId: 'ck_other',
            title: '吃药',
            fireAt: '2026-05-23T02:00:00.000Z',
            timezone: 'Asia/Tokyo',
            idempotencyKey: 'idem_1',
          },
        ],
      },
      {
        toolName: 'list_pending_shared_reminders',
        status: 200,
        service: sharedReminders.listPendingSharedReminders,
        body: {},
        expected: [db as never, { inviteeAccountId: 'ck_provider' }],
      },
      {
        toolName: 'accept_shared_reminder',
        status: 200,
        service: sharedReminders.acceptSharedReminder,
        body: { request_id: 'sr_1', idempotency_key: 'idem_2' },
        expected: [
          db as never,
          runtimePort,
          {
            actorAccountId: 'ck_provider',
            requestId: 'sr_1',
            now: expect.any(Date),
            idempotencyKey: 'idem_2',
          },
        ],
      },
      {
        toolName: 'reject_shared_reminder',
        status: 200,
        service: sharedReminders.rejectSharedReminder,
        body: { request_id: 'sr_1', idempotency_key: 'idem_3' },
        expected: [
          db as never,
          runtimePort,
          {
            actorAccountId: 'ck_provider',
            requestId: 'sr_1',
            now: expect.any(Date),
            idempotencyKey: 'idem_3',
          },
        ],
      },
      {
        toolName: 'cancel_shared_reminder',
        status: 200,
        service: sharedReminders.cancelSharedReminder,
        body: { request_id: 'sr_1', idempotency_key: 'idem_4' },
        expected: [
          db as never,
          runtimePort,
          {
            actorAccountId: 'ck_provider',
            requestId: 'sr_1',
            now: expect.any(Date),
            idempotencyKey: 'idem_4',
          },
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const res = await createApp().request(`/api/internal/scheduling/tools/${testCase.toolName}`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer internal-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: 'ck_provider',
          ...testCase.body,
        }),
      });

      expect(res.status).toBe(testCase.status);
      expect(testCase.service).toHaveBeenCalledWith(...testCase.expected);
    }
  });

  it('routes product notification retry after auth', async () => {
    const unauthorized = await createApp().request('/api/internal/scheduling/notifications/retry', {
      method: 'POST',
    });
    const authorized = await createApp().request('/api/internal/scheduling/notifications/retry', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: 5 }),
    });

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(notifications.deliverPendingProductNotifications).toHaveBeenCalledWith(db as never, {
      limit: 5,
    });
    await expect(authorized.json()).resolves.toEqual({
      ok: true,
      data: { delivered: 1, failed: 0 },
    });
  });

  it('routes product notification retry without a body using the default limit', async () => {
    const res = await createApp().request('/api/internal/scheduling/notifications/retry', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
      },
    });

    expect(res.status).toBe(200);
    expect(notifications.deliverPendingProductNotifications).toHaveBeenCalledWith(db as never, {
      limit: 50,
    });
  });

  it.each([
    { label: 'content type', headers: { 'content-type': 'application/json' } },
    { label: 'zero content length', headers: { 'content-length': '0' } },
  ])('routes product notification retry with empty body and $label header', async ({ headers }) => {
    const res = await createApp().request('/api/internal/scheduling/notifications/retry', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        ...headers,
      },
    });

    expect(res.status).toBe(200);
    expect(notifications.deliverPendingProductNotifications).toHaveBeenCalledWith(db as never, {
      limit: 50,
    });
  });

});
