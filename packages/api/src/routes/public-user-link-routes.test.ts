import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readPublicUserLinkByCode: vi.fn(),
  createLinkSession: vi.fn(),
}));

vi.mock('../scheduling/user-link-service.js', () => mocks);
vi.mock('../db/index.js', () => ({ db: {} }));

import { publicUserLinkRouter } from './public-user-link-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/public/user-links', publicUserLinkRouter);
  return app;
}

describe('public user link routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
