import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readPublicUserLinkByCode: vi.fn(),
  createLinkSession: vi.fn(),
  getLinkSessionStatus: vi.fn(),
  sendFriendRequestFromLinkSession: vi.fn(),
  verifyCustomerToken: vi.fn(),
  getCustomerSession: vi.fn(),
}));

vi.mock('../scheduling/user-link-service.js', () => ({
  readPublicUserLinkByCode: mocks.readPublicUserLinkByCode,
  createLinkSession: mocks.createLinkSession,
  getLinkSessionStatus: mocks.getLinkSessionStatus,
  sendFriendRequestFromLinkSession: mocks.sendFriendRequestFromLinkSession,
}));
vi.mock('../lib/customer-auth.js', () => ({
  verifyCustomerToken: mocks.verifyCustomerToken,
  getCustomerSession: mocks.getCustomerSession,
}));
vi.mock('../db/index.js', () => ({ db: {} }));

import { publicLinkSessionRouter, publicUserLinkRouter } from './public-user-link-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/public/user-links', publicUserLinkRouter);
  app.route('/api/public/link-sessions', publicLinkSessionRouter);
  return app;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('public user link routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCustomerToken.mockReturnValue({
      sub: 'ck_visitor',
      identityId: 'idt_visitor',
      tokenType: 'access',
    });
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_visitor',
      identityId: 'idt_visitor',
      claimStatus: 'active',
      email: 'visitor@example.com',
      membershipRole: 'owner',
    });
  });

  it('returns public profile for an active code without treating it as a provider account id', async () => {
    mocks.readPublicUserLinkByCode.mockResolvedValueOnce({
      code: 'AbCdEfGhIjK_',
      status: 'active',
      url: 'https://kap.example/u/AbCdEfGhIjK_',
      qrUrl: 'https://kap.example/u/AbCdEfGhIjK_/qr',
      profile: { displayName: 'Coach A', tagline: 'Strength', avatarUrl: null },
    });

    const res = await createApp().request('/api/public/user-links/AbCdEfGhIjK_');

    expect(res.status).toBe(200);
    expect(mocks.readPublicUserLinkByCode).toHaveBeenCalledWith({} as never, {
      code: 'AbCdEfGhIjK_',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        code: 'AbCdEfGhIjK_',
        status: 'active',
        url: 'https://kap.example/u/AbCdEfGhIjK_',
        qrUrl: 'https://kap.example/u/AbCdEfGhIjK_/qr',
        profile: { displayName: 'Coach A', tagline: 'Strength', avatarUrl: null },
      },
    });
  });

  it('returns 404 for inactive or missing codes', async () => {
    mocks.readPublicUserLinkByCode.mockResolvedValueOnce(null);

    const res = await createApp().request('/api/public/user-links/missing-code');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'link_not_active' });
  });

  it('opens a link session and returns auth URLs containing link_session', async () => {
    mocks.createLinkSession.mockResolvedValueOnce({
      token: 'session-token',
      targetAccountId: 'ck_provider',
      loginUrl: '/auth/login?next=%2Fu%2FAbCdEfGhIjK_%3Flink_session%3Dsession-token',
      registerUrl: '/auth/register?next=%2Fu%2FAbCdEfGhIjK_%3Flink_session%3Dsession-token',
      expiresAt: '2026-05-22T00:00:00.000Z',
    });

    const res = await createApp().request('/api/public/user-links/AbCdEfGhIjK_/sessions', {
      method: 'POST',
    });

    expect(res.status).toBe(201);
    expect(mocks.createLinkSession).toHaveBeenCalledWith({} as never, { code: 'AbCdEfGhIjK_' });
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        token: 'session-token',
        targetAccountId: 'ck_provider',
      },
    });
    expect(body.data.loginUrl).toContain('link_session');
    expect(body.data.registerUrl).toContain('link_session');
    expect(body.data).not.toHaveProperty('nextUrl');
  });

  it('returns link-session status from the public link-session surface', async () => {
    mocks.getLinkSessionStatus.mockResolvedValueOnce({
      status: 'opened',
      providerAccountId: 'ck_provider',
      consumerAccountId: null,
      expiresAt: new Date('2026-05-22T00:00:00.000Z'),
    });

    const res = await createApp().request('/api/public/link-sessions/session-token/status');

    expect(res.status).toBe(200);
    expect(mocks.getLinkSessionStatus).toHaveBeenCalledWith({} as never, {
      token: 'session-token',
    });
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: {
        status: 'opened',
        providerAccountId: 'ck_provider',
        consumerAccountId: null,
      },
    });
  });

  it('requires customer auth before creating a friend request from a link session', async () => {
    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Let us connect' }),
    });

    expect(res.status).toBe(401);
    expect(mocks.verifyCustomerToken).not.toHaveBeenCalled();
    expect(mocks.sendFriendRequestFromLinkSession).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('creates a friend request from an authenticated public link session', async () => {
    mocks.sendFriendRequestFromLinkSession.mockResolvedValueOnce({
      id: 'fr_1',
      linkSessionId: 'ls_1',
      requesterAccountId: 'ck_visitor',
      targetAccountId: 'ck_target',
      idempotencyKey: 'friend-request:ck_visitor:secret',
      status: 'pending',
      createdAt: new Date('2026-05-22T00:00:00.000Z'),
      updatedAt: new Date('2026-05-22T00:00:00.000Z'),
    });

    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'Let us connect' }),
    });

    expect(res.status).toBe(201);
    expect(mocks.verifyCustomerToken).toHaveBeenCalledWith('customer-token');
    expect(mocks.sendFriendRequestFromLinkSession).toHaveBeenCalledWith({} as never, {
      token: 'session-token',
      requesterAccountId: 'ck_visitor',
      message: 'Let us connect',
      idempotencyKey: `friend-request:ck_visitor:${sha256Hex('session-token')}`,
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'fr_1',
        status: 'pending',
      },
    });
  });

  it('uses a stable route-generated idempotency key', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(111).mockReturnValueOnce(222);
    mocks.sendFriendRequestFromLinkSession.mockResolvedValue({
      id: 'fr_1',
      requesterAccountId: 'ck_visitor',
      targetAccountId: 'ck_target',
      status: 'pending',
    });

    const app = createApp();
    await app.request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'Let us connect' }),
    });
    await app.request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'Let us connect' }),
    });

    const expectedIdempotencyKey = `friend-request:ck_visitor:${sha256Hex('session-token')}`;
    expect(mocks.sendFriendRequestFromLinkSession).toHaveBeenNthCalledWith(1, {} as never, {
      token: 'session-token',
      requesterAccountId: 'ck_visitor',
      message: 'Let us connect',
      idempotencyKey: expectedIdempotencyKey,
    });
    expect(mocks.sendFriendRequestFromLinkSession).toHaveBeenNthCalledWith(2, {} as never, {
      token: 'session-token',
      requesterAccountId: 'ck_visitor',
      message: 'Let us connect',
      idempotencyKey: expectedIdempotencyKey,
    });
    expect(expectedIdempotencyKey).not.toContain('session-token');
  });

  it('ignores public idempotency overrides', async () => {
    mocks.sendFriendRequestFromLinkSession.mockResolvedValueOnce({
      id: 'fr_1',
      status: 'pending',
    });

    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Let us connect',
        idempotencyKey: 'attacker-controlled',
        idempotency_key: 'attacker-controlled-snake',
      }),
    });

    expect(res.status).toBe(201);
    expect(mocks.sendFriendRequestFromLinkSession).toHaveBeenCalledWith({} as never, {
      token: 'session-token',
      requesterAccountId: 'ck_visitor',
      message: 'Let us connect',
      idempotencyKey: `friend-request:ck_visitor:${sha256Hex('session-token')}`,
    });
  });

  it('trims friend request messages before calling the service', async () => {
    mocks.sendFriendRequestFromLinkSession.mockResolvedValueOnce({
      id: 'fr_1',
      status: 'pending',
    });

    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: '  Let us connect  ' }),
    });

    expect(res.status).toBe(201);
    expect(mocks.sendFriendRequestFromLinkSession).toHaveBeenCalledWith({} as never, {
      token: 'session-token',
      requesterAccountId: 'ck_visitor',
      message: 'Let us connect',
      idempotencyKey: `friend-request:ck_visitor:${sha256Hex('session-token')}`,
    });
  });

  it('treats an empty friend request message as null', async () => {
    mocks.sendFriendRequestFromLinkSession.mockResolvedValueOnce({
      id: 'fr_1',
      status: 'pending',
    });

    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: '   ' }),
    });

    expect(res.status).toBe(201);
    expect(mocks.sendFriendRequestFromLinkSession).toHaveBeenCalledWith({} as never, {
      token: 'session-token',
      requesterAccountId: 'ck_visitor',
      message: null,
      idempotencyKey: `friend-request:ck_visitor:${sha256Hex('session-token')}`,
    });
  });

  it('rejects overlong friend request messages before calling the service', async () => {
    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'x'.repeat(501) }),
    });

    expect(res.status).toBe(400);
    expect(mocks.sendFriendRequestFromLinkSession).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_body' });
  });

  it('passes known friend-request domain errors through', async () => {
    mocks.sendFriendRequestFromLinkSession.mockRejectedValueOnce(new Error('cannot_friend_self'));

    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'Let us connect' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'cannot_friend_self' });
  });

  it('maps unknown friend-request errors to a public failure code', async () => {
    mocks.sendFriendRequestFromLinkSession.mockRejectedValueOnce(new Error('database exploded'));

    const res = await createApp().request('/api/public/link-sessions/session-token/friend-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'Let us connect' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'friend_request_failed' });
  });

});
