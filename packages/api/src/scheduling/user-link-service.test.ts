import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLinkSession,
  disableUserLink,
  getOrCreateActiveUserLink,
  readPublicUserLinkByCode,
  resetUserLink,
  sendFriendRequestByUserLinkCode,
  sendFriendRequestFromLinkSession,
} from './user-link-service.js';

const db = {
  userLink: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  linkSession: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  customer: { findUnique: vi.fn() },
  friendRequest: { findFirst: vi.fn(), create: vi.fn() },
  accountBlock: { findFirst: vi.fn() },
  productNotification: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
};

describe('user link service', () => {
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
    db.productNotification.create.mockResolvedValue({
      id: 'pn_1',
      recipientAccountId: 'acct_a',
      idempotencyKey: 'friend-request:fr_1:target',
      kind: 'friend_request',
      payload: {
        text: '你有一个新的好友请求，请确认或拒绝。',
        metadata: {
          request_id: 'fr_1',
          request_type: 'friend_request',
          actor_account_id: 'acct_b',
          allowed_actions: ['accept', 'reject'],
        },
      },
      status: 'pending_delivery',
    });
    db.productNotification.updateMany.mockResolvedValue({ count: 1 });
    process.env.DOMAIN_CLIENT = 'https://kap.example';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('creates a first active user link with shareable profile fields', async () => {
    db.userLink.findFirst.mockResolvedValueOnce(null);
    db.customer.findUnique.mockResolvedValueOnce({
      id: 'ck_a',
      displayName: 'Coach A',
      tagline: 'Strength coaching',
      avatarUrl: 'https://img.example/a.png',
    });
    db.userLink.create.mockResolvedValueOnce({ id: 'ul_1', code: 'AbCdEfGhIjK_', status: 'active' });

    const result = await getOrCreateActiveUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(result.url).toBe('https://kap.example/u/AbCdEfGhIjK_');
    expect(result.qrUrl).toBe('https://kap.example/u/AbCdEfGhIjK_/qr');
    expect(result.profile).toEqual({
      displayName: 'Coach A',
      tagline: 'Strength coaching',
      avatarUrl: 'https://img.example/a.png',
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('providerAccountId');
    expect(db.userLink.create.mock.calls[0][0].data.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('re-reads the active user link when first creation loses a unique race', async () => {
    db.userLink.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ul_1', code: 'RaceWin123_', status: 'active', providerAccountId: 'ck_a' });
    db.userLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    db.customer.findUnique.mockResolvedValueOnce({
      id: 'ck_a',
      displayName: 'Coach A',
      tagline: null,
      avatarUrl: null,
    });

    const result = await getOrCreateActiveUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(result.url).toBe('https://kap.example/u/RaceWin123_');
    expect(db.userLink.findFirst).toHaveBeenCalledTimes(2);
  });

  it('resets by disabling the old active code and creating a new one', async () => {
    db.customer.findUnique.mockResolvedValueOnce({ id: 'ck_a', displayName: 'Coach A', tagline: null, avatarUrl: null });
    db.userLink.create.mockResolvedValueOnce({ id: 'ul_2', code: 'NewCode123__', status: 'active' });

    const result = await resetUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(db.userLink.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'disabled', disabledAt: expect.any(Date) },
    });
    expect(result.qrUrl).toBe('https://kap.example/u/NewCode123__/qr');
    expect(db.userLink.create).toHaveBeenCalled();
  });

  it('uses a transaction for reset when the root client supports it', async () => {
    const tx = {
      userLink: { updateMany: vi.fn(), create: vi.fn() },
    };
    db.$transaction.mockImplementationOnce(async (fn) => fn(tx));
    tx.userLink.create.mockResolvedValueOnce({ id: 'ul_2', code: 'NewCode123__', status: 'active' });
    db.customer.findUnique.mockResolvedValueOnce({ id: 'ck_a', displayName: 'Coach A', tagline: null, avatarUrl: null });

    await resetUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.userLink.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'disabled', disabledAt: expect.any(Date) },
    });
    expect(tx.userLink.create).toHaveBeenCalled();
    expect(db.userLink.updateMany).not.toHaveBeenCalled();
  });

  it('re-reads active link when concurrent reset creation loses a unique race', async () => {
    db.userLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    db.userLink.findFirst.mockResolvedValueOnce({
      id: 'ul_race',
      code: 'ResetRace12_',
      status: 'active',
      providerAccountId: 'ck_a',
    });
    db.customer.findUnique.mockResolvedValueOnce({ id: 'ck_a', displayName: 'Coach A', tagline: null, avatarUrl: null });

    const result = await resetUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(result.url).toBe('https://kap.example/u/ResetRace12_');
    expect(result.qrUrl).toBe('https://kap.example/u/ResetRace12_/qr');
    expect(db.userLink.findFirst).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('reads only an active public user link by code without exposing provider account id', async () => {
    db.userLink.findFirst.mockResolvedValueOnce({
      id: 'ul_1',
      code: 'AbCdEfGhIjK_',
      status: 'active',
      providerAccountId: 'ck_a',
    });
    db.customer.findUnique.mockResolvedValueOnce({
      id: 'ck_a',
      displayName: 'Coach A',
      tagline: 'Strength coaching',
      avatarUrl: null,
    });

    const result = await readPublicUserLinkByCode(db as never, { code: 'AbCdEfGhIjK_' });

    expect(db.userLink.findFirst).toHaveBeenCalledWith({
      where: { code: 'AbCdEfGhIjK_', status: 'active' },
    });
    expect(result).toMatchObject({
      code: 'AbCdEfGhIjK_',
      status: 'active',
      qrUrl: 'https://kap.example/u/AbCdEfGhIjK_/qr',
      profile: { displayName: 'Coach A', tagline: 'Strength coaching', avatarUrl: null },
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('providerAccountId');
  });

  it('disables active user links without creating a replacement', async () => {
    db.userLink.updateMany.mockResolvedValueOnce({ count: 1 });

    await disableUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(db.userLink.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'disabled', disabledAt: expect.any(Date) },
    });
    expect(db.userLink.create).not.toHaveBeenCalled();
  });

  it('opens a 30 day link session without notifying the target', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T00:00:00.000Z'));
    db.userLink.findFirst.mockResolvedValueOnce({
      id: 'ul_1',
      code: 'AbCdEfGhIjK_',
      status: 'active',
      providerAccountId: 'ck_a',
    });
    db.linkSession.create.mockImplementation(async ({ data }) => ({ id: 'ls_1', ...data }));

    const result = await createLinkSession(db as never, { code: 'AbCdEfGhIjK_' });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.targetAccountId).toBe('ck_a');
    expect(result.loginUrl).toContain('/auth/login?next=');
    expect(result.registerUrl).toContain('/auth/register?next=');
    expect(db.linkSession.create.mock.calls[0][0].data.tokenHash).not.toBe(result.token);
    expect(db.linkSession.create.mock.calls[0][0].data.tokenHash).toHaveLength(64);
    expect(db.linkSession.create.mock.calls[0][0].data.userLinkId).toBe('ul_1');
    expect(db.linkSession.create.mock.calls[0][0].data.providerAccountId).toBe('ck_a');
    expect(db.linkSession.create.mock.calls[0][0].data.status).toBe('opened');
    expect(db.linkSession.create.mock.calls[0][0].data.expiresAt).toEqual(
      new Date('2026-06-21T00:00:00.000Z'),
    );
    expect(result.expiresAt).toBe('2026-06-21T00:00:00.000Z');
    expect(db.productNotification.create).not.toHaveBeenCalled();
    expect(result.loginUrl).toContain(encodeURIComponent(`link_session=${result.token}`));
    expect(result.loginUrl).toContain(
      encodeURIComponent(`/account/friends?link_session=${result.token}`),
    );
    expect(result.registerUrl).toContain(
      encodeURIComponent(`/account/friends?link_session=${result.token}`),
    );
    expect(result.loginUrl).not.toContain(encodeURIComponent('/u/AbCdEfGhIjK_'));
    expect(result).not.toHaveProperty('nextUrl');
    expect(result).not.toHaveProperty('session');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('userLinkId');
    expect(result).not.toHaveProperty('providerAccountId');
  });

  it('creates a pending friend request from a public user-link code in chat', async () => {
    db.userLink.findFirst.mockResolvedValueOnce({
      id: 'ul_1',
      providerAccountId: 'acct_a',
      code: 'AbCdEfGhIjK_',
      status: 'active',
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendRequest.findFirst.mockResolvedValueOnce(null);
    db.friendRequest.create.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'acct_b',
      targetAccountId: 'acct_a',
      linkSessionId: null,
      status: 'pending',
    });
    db.productNotification.findFirst.mockResolvedValueOnce(null);

    const result = await sendFriendRequestByUserLinkCode(db as never, {
      code: 'AbCdEfGhIjK_',
      requesterAccountId: 'acct_b',
      message: '一起测试提醒',
      idempotencyKey: 'friend:req:code',
    });

    expect(result).toMatchObject({ id: 'fr_1', status: 'pending' });
    expect(db.friendRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requesterAccountId: 'acct_b',
        targetAccountId: 'acct_a',
        linkSessionId: null,
        message: '一起测试提醒',
        idempotencyKey: 'friend:req:code',
        status: 'pending',
      }),
    });
    expect(db.productNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        friendRequestId: 'fr_1',
        recipientAccountId: 'acct_a',
        kind: 'friend_request',
      }),
    });
  });

  it('creates a pending friend request when an authenticated visitor claims a link session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T00:00:00.000Z'));
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendRequest.findFirst.mockResolvedValueOnce(null);
    db.linkSession.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.create.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'acct_b',
      targetAccountId: 'acct_a',
      linkSessionId: 'ls_1',
      status: 'pending',
    });
    db.productNotification.findFirst.mockResolvedValueOnce(null);

    const result = await sendFriendRequestFromLinkSession(db as never, {
      token: 'session-token',
      requesterAccountId: 'acct_b',
      message: 'Let us connect',
      idempotencyKey: 'friend:req:1',
    });

    expect(result).toMatchObject({ id: 'fr_1', status: 'pending' });
    expect(db.friendRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requesterAccountId: 'acct_b',
        targetAccountId: 'acct_a',
        linkSessionId: 'ls_1',
        message: 'Let us connect',
        idempotencyKey: 'friend:req:1',
        status: 'pending',
      }),
    });
    expect(db.linkSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'ls_1', status: 'opened' },
      data: {
        status: 'claimed',
        consumerAccountId: 'acct_b',
        claimedAt: expect.any(Date),
      },
    });
    expect(db.productNotification.findFirst).toHaveBeenCalledWith({
      where: { idempotencyKey: 'friend-request:fr_1:target' },
    });
    expect(db.productNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        friendRequestId: 'fr_1',
        recipientAccountId: 'acct_a',
        kind: 'friend_request',
        payload: {
          text: '你有一个新的好友请求，请确认或拒绝。',
          metadata: {
            request_id: 'fr_1',
            request_type: 'friend_request',
            actor_account_id: 'acct_b',
            allowed_actions: ['accept', 'reject'],
          },
        },
        status: 'pending_delivery',
      }),
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/inbound',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
  });

  it('delivers friend request notifications only after the friend request transaction commits', async () => {
    const events: string[] = [];
    const tx = {
      linkSession: { findUnique: vi.fn(), updateMany: vi.fn() },
      friendRequest: { findFirst: vi.fn(), create: vi.fn() },
      accountBlock: { findFirst: vi.fn() },
      productNotification: {
        findFirst: vi.fn(() => {
          throw new Error('notification_in_transaction');
        }),
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
    tx.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });
    tx.accountBlock.findFirst.mockResolvedValueOnce(null);
    tx.friendRequest.findFirst.mockResolvedValueOnce(null);
    tx.linkSession.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.friendRequest.create.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'acct_b',
      targetAccountId: 'acct_a',
      linkSessionId: 'ls_1',
      status: 'pending',
    });
    db.productNotification.findFirst.mockImplementationOnce(async () => {
      events.push('notification:find');
      return null;
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

    const result = await sendFriendRequestFromLinkSession(db as never, {
      token: 'session-token',
      requesterAccountId: 'acct_b',
      message: 'Let us connect',
      idempotencyKey: 'friend:req:after-commit',
    });

    expect(result).toMatchObject({ id: 'fr_1', status: 'pending' });
    expect(tx.productNotification.findFirst).not.toHaveBeenCalled();
    expect(tx.productNotification.create).not.toHaveBeenCalled();
    expect(events).toEqual([
      'transaction:start',
      'transaction:commit',
      'notification:find',
      'notification:create',
      'bridge:fetch',
      'notification:delivered',
    ]);
  });

  it('returns the existing pending request when the same requester retries after claiming', async () => {
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: 'acct_b',
      status: 'claimed',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });
    db.friendRequest.findFirst.mockResolvedValueOnce({
      id: 'fr_existing',
      requesterAccountId: 'acct_b',
      targetAccountId: 'acct_a',
      status: 'pending',
    });
    db.productNotification.findFirst.mockResolvedValueOnce({ id: 'pn_existing' });

    const result = await sendFriendRequestFromLinkSession(db as never, {
      token: 'session-token',
      requesterAccountId: 'acct_b',
      message: null,
      idempotencyKey: 'friend:req:retry',
    });

    expect(result).toMatchObject({ id: 'fr_existing', status: 'pending' });
    expect(db.friendRequest.create).not.toHaveBeenCalled();
    expect(db.linkSession.updateMany).not.toHaveBeenCalled();
    expect(db.productNotification.findFirst).toHaveBeenCalledWith({
      where: { idempotencyKey: 'friend-request:fr_existing:target' },
    });
    expect(db.productNotification.create).not.toHaveBeenCalled();
  });

  it('fails closed when another requester already claimed the link session', async () => {
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: 'acct_c',
      status: 'claimed',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });

    await expect(
      sendFriendRequestFromLinkSession(db as never, {
        token: 'session-token',
        requesterAccountId: 'acct_b',
        message: null,
        idempotencyKey: 'friend:req:claimed',
      }),
    ).rejects.toThrow('invalid_link_session');

    expect(db.friendRequest.findFirst).not.toHaveBeenCalled();
    expect(db.friendRequest.create).not.toHaveBeenCalled();
    expect(db.productNotification.create).not.toHaveBeenCalled();
  });

  it('re-reads the pending request when conditional session claim loses a race', async () => {
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'fr_existing',
        requesterAccountId: 'acct_b',
        targetAccountId: 'acct_a',
        status: 'pending',
      });
    db.linkSession.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await sendFriendRequestFromLinkSession(db as never, {
      token: 'session-token',
      requesterAccountId: 'acct_b',
      message: null,
      idempotencyKey: 'friend:req:race',
    });

    expect(result).toMatchObject({ id: 'fr_existing', status: 'pending' });
    expect(db.friendRequest.create).not.toHaveBeenCalled();
    expect(db.productNotification.create).not.toHaveBeenCalled();
  });

  it('rejects friend requests when the target blocked the requester', async () => {
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });
    db.accountBlock.findFirst.mockResolvedValueOnce({ id: 'blk_1' });

    await expect(
      sendFriendRequestFromLinkSession(db as never, {
        token: 'session-token',
        requesterAccountId: 'acct_b',
        message: null,
        idempotencyKey: 'friend:req:block',
      }),
    ).rejects.toThrow('friend_request_blocked');

    expect(db.linkSession.updateMany).not.toHaveBeenCalled();
    expect(db.friendRequest.create).not.toHaveBeenCalled();
  });

  it('rejects expired link sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T00:00:00.000Z'));
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-05-22T00:00:00.000Z'),
    });

    await expect(
      sendFriendRequestFromLinkSession(db as never, {
        token: 'session-token',
        requesterAccountId: 'acct_b',
        message: null,
        idempotencyKey: 'friend:req:expired',
      }),
    ).rejects.toThrow('link_session_expired');

    expect(db.accountBlock.findFirst).not.toHaveBeenCalled();
    expect(db.linkSession.updateMany).not.toHaveBeenCalled();
  });

  it('recovers from friend request unique races by reading the existing pending request', async () => {
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'fr_existing',
        requesterAccountId: 'acct_b',
        targetAccountId: 'acct_a',
        status: 'pending',
      });
    db.linkSession.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    db.productNotification.findFirst.mockResolvedValueOnce(null);

    const result = await sendFriendRequestFromLinkSession(db as never, {
      token: 'session-token',
      requesterAccountId: 'acct_b',
      message: null,
      idempotencyKey: 'friend:req:unique',
    });

    expect(result).toMatchObject({ id: 'fr_existing', status: 'pending' });
    expect(db.productNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        friendRequestId: 'fr_existing',
        idempotencyKey: 'friend-request:fr_existing:target',
      }),
    });
  });

  it('treats duplicate product notifications as successful request creation', async () => {
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });
    db.accountBlock.findFirst.mockResolvedValueOnce(null);
    db.friendRequest.findFirst.mockResolvedValueOnce(null);
    db.linkSession.updateMany.mockResolvedValueOnce({ count: 1 });
    db.friendRequest.create.mockResolvedValueOnce({
      id: 'fr_1',
      requesterAccountId: 'acct_b',
      targetAccountId: 'acct_a',
      status: 'pending',
    });
    db.productNotification.findFirst.mockResolvedValueOnce(null);
    db.productNotification.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );

    const result = await sendFriendRequestFromLinkSession(db as never, {
      token: 'session-token',
      requesterAccountId: 'acct_b',
      message: null,
      idempotencyKey: 'friend:req:notification',
    });

    expect(result).toMatchObject({ id: 'fr_1', status: 'pending' });
  });

  it('rejects self-claiming a user link session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T00:00:00.000Z'));
    db.linkSession.findUnique.mockResolvedValueOnce({
      id: 'ls_1',
      providerAccountId: 'acct_a',
      consumerAccountId: null,
      status: 'opened',
      expiresAt: new Date('2026-06-21T00:00:00.000Z'),
    });

    await expect(
      sendFriendRequestFromLinkSession(db as never, {
        token: 'session-token',
        requesterAccountId: 'acct_a',
        message: null,
        idempotencyKey: 'friend:req:self',
      }),
    ).rejects.toThrow('cannot_friend_self');

    expect(db.friendRequest.create).not.toHaveBeenCalled();
    expect(db.linkSession.updateMany).not.toHaveBeenCalled();
    expect(db.productNotification.create).not.toHaveBeenCalled();
  });

});
