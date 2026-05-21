import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readPublicUserLinkByCode: vi.fn(),
  createLinkSession: vi.fn(),
  getLinkSessionStatus: vi.fn(),
  claimLinkSession: vi.fn(),
  verifyCustomerToken: vi.fn(),
  getCustomerSession: vi.fn(),
}));

vi.mock('../scheduling/user-link-service.js', () => mocks);
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
    mocks.verifyCustomerToken.mockReturnValue({ sub: 'ck_consumer', identityId: 'idt_1' });
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_consumer',
      identityId: 'idt_1',
      claimStatus: 'active',
      email: 'b@example.com',
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

  it('requires customer auth before claiming a link session', async () => {
    const res = await createApp().request('/api/public/link-sessions/session-token/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: 'ck_attacker' }),
    });

    expect(res.status).toBe(401);
    expect(mocks.claimLinkSession).not.toHaveBeenCalled();
  });

  it('claims a link session for the authenticated customer', async () => {
    mocks.claimLinkSession.mockResolvedValueOnce({
      status: 'claimed',
      providerAccountId: 'ck_provider',
      consumerAccountId: 'ck_consumer',
      expiresAt: new Date('2026-05-22T00:00:00.000Z'),
    });

    const res = await createApp().request('/api/public/link-sessions/session-token/claim', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token', 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: 'ck_attacker' }),
    });

    expect(res.status).toBe(200);
    expect(mocks.verifyCustomerToken).toHaveBeenCalledWith('customer-token');
    expect(mocks.claimLinkSession).toHaveBeenCalledWith({} as never, {
      token: 'session-token',
      consumerAccountId: 'ck_consumer',
    });
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: {
        status: 'claimed',
        providerAccountId: 'ck_provider',
        consumerAccountId: 'ck_consumer',
      },
    });
  });
});
