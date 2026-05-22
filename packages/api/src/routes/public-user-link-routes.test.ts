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
      nextUrl: '/auth/login?next=%2Fu%2FAbCdEfGhIjK_%3Flink_session%3Dsession-token',
      registerUrl: '/auth/register?next=%2Fu%2FAbCdEfGhIjK_%3Flink_session%3Dsession-token',
      expiresAt: new Date('2026-05-22T00:00:00.000Z'),
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
      },
    });
    expect(body.data.nextUrl).toContain('link_session');
    expect(body.data.registerUrl).toContain('link_session');
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
      requesterAccountId: 'ck_visitor',
      targetAccountId: 'ck_target',
      status: 'pending',
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
      idempotencyKey: expect.stringContaining('friend-request:ck_visitor:session-token:'),
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'fr_1',
        requesterAccountId: 'ck_visitor',
        targetAccountId: 'ck_target',
        status: 'pending',
      },
    });
  });

  it('fails closed for the retired link-session claim path', async () => {
    const res = await createApp().request('/api/public/link-sessions/session-token/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: 'ck_attacker' }),
    });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'appointment_scheduling_retired',
    });
  });
});
