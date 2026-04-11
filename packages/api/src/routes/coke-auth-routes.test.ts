import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  cokeAccount: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  verifyToken: {
    create: vi.fn(),
  },
}));

const ensureClawscaleUserForCokeAccount = vi.hoisted(() => vi.fn());
const sendCokeEmail = vi.hoisted(() => vi.fn());
const resolveCokeAccountAccess = vi.hoisted(() => vi.fn());
const verifyCokeToken = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/clawscale-user.js', () => ({ ensureClawscaleUserForCokeAccount }));
vi.mock('../lib/email.js', () => ({ sendCokeEmail }));
vi.mock('../lib/coke-account-access.js', () => ({ resolveCokeAccountAccess }));
vi.mock('../lib/coke-auth.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/coke-auth.js')>(
    '../lib/coke-auth.js',
  );
  return {
    ...actual,
    hashPassword: vi.fn(async () => 'hashed-password'),
    verifyPassword: vi.fn(async () => true),
    verifyCokeToken,
    issueVerifyToken: vi.fn(() => ({
      plainToken: 'plain-token',
      tokenHash: 'token-hash',
    })),
    signCokeToken: vi.fn(() => 'signed-token'),
  };
});

import { cokeAuthRouter } from './coke-auth-routes.js';

describe('coke auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_CLIENT = 'https://coke.example';
  });

  it('registers a new Coke account and sends a verification email', async () => {
    db.cokeAccount.findUnique.mockResolvedValue(null);
    db.cokeAccount.create.mockResolvedValue({
      id: 'acct_1',
      email: 'alice@example.com',
      displayName: 'Alice',
      emailVerified: false,
      status: 'normal',
    });
    ensureClawscaleUserForCokeAccount.mockResolvedValue({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
      created: true,
      ready: true,
    });
    db.verifyToken.create.mockResolvedValue({ id: 'vrt_1' });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Alice',
        email: ' Alice@Example.com ',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(201);
    expect(db.cokeAccount.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
    expect(db.cokeAccount.create).toHaveBeenCalledWith({
      data: {
        email: 'alice@example.com',
        displayName: 'Alice',
        passwordHash: 'hashed-password',
      },
    });
    expect(ensureClawscaleUserForCokeAccount).toHaveBeenCalledWith({
      cokeAccountId: 'acct_1',
      displayName: 'Alice',
    });
    expect(db.verifyToken.create).toHaveBeenCalledWith({
      data: {
        cokeAccountId: 'acct_1',
        tokenHash: 'token-hash',
        type: 'email_verify',
        expiresAt: expect.any(Date),
      },
    });
    expect(sendCokeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        html: expect.stringContaining(
          'https://coke.example/coke/verify-email?token=plain-token&email=alice@example.com',
        ),
      }),
    );
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        token: 'signed-token',
        user: {
          id: 'acct_1',
          email: 'alice@example.com',
          display_name: 'Alice',
          email_verified: false,
          status: 'normal',
        },
      },
    });
  });

  it('rejects duplicate email registration', async () => {
    db.cokeAccount.findUnique.mockResolvedValue({
      id: 'acct_existing',
      email: 'alice@example.com',
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Alice',
        email: 'alice@example.com',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(409);
    expect(db.cokeAccount.create).not.toHaveBeenCalled();
    expect(sendCokeEmail).not.toHaveBeenCalled();
  });

  it('returns unauthorized when /me is missing a bearer token', async () => {
    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/me');

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('returns invalid_or_expired_token when the bearer token is invalid', async () => {
    verifyCokeToken.mockImplementation(() => {
      throw new Error('bad token');
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/me', {
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_or_expired_token',
    });
  });

  it('returns the current Coke account profile from /me', async () => {
    verifyCokeToken.mockReturnValue({
      sub: 'acct_1',
      email: 'alice@example.com',
    });
    db.cokeAccount.findUnique.mockResolvedValue({
      id: 'acct_1',
      email: 'alice@example.com',
      displayName: 'Alice',
      emailVerified: true,
      status: 'normal',
    });
    resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://coke.example/coke/renew',
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/me', {
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(200);
    expect(db.cokeAccount.findUnique).toHaveBeenCalledWith({
      where: { id: 'acct_1' },
    });
    expect(resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'acct_1',
        displayName: 'Alice',
        emailVerified: true,
        status: 'normal',
      },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'acct_1',
        email: 'alice@example.com',
        display_name: 'Alice',
        email_verified: true,
        status: 'normal',
        subscription_active: true,
        subscription_expires_at: '2026-05-10T00:00:00.000Z',
      },
    });
  });
});
