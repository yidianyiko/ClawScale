import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const tx = vi.hoisted(() => ({
  cokeAccount: {
    update: vi.fn(),
  },
  verifyToken: {
    update: vi.fn(),
  },
}));

const db = vi.hoisted(() => ({
  cokeAccount: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  verifyToken: {
    create: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
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
    hashPassword: vi.fn(async (plain: string) => 'hashed:' + plain),
    verifyPassword: vi.fn(async () => true),
    verifyCokeToken,
    issueVerifyToken: vi.fn(() => ({
      plainToken: 'plain-token',
      tokenHash: 'token-hash',
    })),
    signCokeToken: vi.fn(() => 'signed-token'),
  };
});

import { sha256Hex } from '../lib/coke-auth.js';
import { cokeAuthRouter } from './coke-auth-routes.js';

describe('coke auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_CLIENT = 'https://coke.example';
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    db.verifyToken.create.mockResolvedValue({ id: 'vrt_1' });
    db.verifyToken.deleteMany.mockResolvedValue({ count: 1 });
    tx.verifyToken.update.mockResolvedValue({ id: 'vrt_1' });
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
        passwordHash: 'hashed:password123',
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
          'https://coke.example/coke/verify-email?token=plain-token&email=alice%40example.com',
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

  it('still returns the auth payload when verification email delivery fails during registration', async () => {
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
    sendCokeEmail.mockRejectedValueOnce(new Error('smtp down'));

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

    expect(res.status).toBe(201);
    expect(sendCokeEmail).toHaveBeenCalledOnce();
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

  it('verifies a Coke email token and returns a fresh auth payload', async () => {
    db.verifyToken.findFirst.mockResolvedValue({
      id: 'vrt_1',
      cokeAccountId: 'acct_1',
      type: 'email_verify',
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
      account: {
        id: 'acct_1',
        email: 'alice@example.com',
        displayName: 'Alice',
        emailVerified: false,
        status: 'normal',
        passwordHash: 'hashed-password',
      },
    });
    tx.cokeAccount.update.mockResolvedValue({
      id: 'acct_1',
      email: 'alice@example.com',
      displayName: 'Alice',
      emailVerified: true,
      status: 'normal',
      passwordHash: 'hashed-password',
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

    const res = await app.request('/api/coke/verify-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: ' Alice@Example.com ',
        token: 'plain-token',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.verifyToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: sha256Hex('plain-token'),
          type: 'email_verify',
          used: false,
        }),
        include: { account: true },
      }),
    );
    expect(tx.cokeAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct_1' },
      data: { emailVerified: true },
    });
    expect(tx.verifyToken.update).toHaveBeenCalledWith({
      where: { id: 'vrt_1' },
      data: { used: true },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        token: 'signed-token',
        user: {
          id: 'acct_1',
          email: 'alice@example.com',
          display_name: 'Alice',
          email_verified: true,
          status: 'normal',
          subscription_active: true,
          subscription_expires_at: '2026-05-10T00:00:00.000Z',
        },
      },
    });
  });

  it('rejects invalid or expired email verification tokens', async () => {
    db.verifyToken.findFirst.mockResolvedValue(null);

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/verify-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
        token: 'plain-token',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_or_expired_token',
    });
  });

  it('resends a verification email for an unverified account', async () => {
    db.cokeAccount.findUnique.mockResolvedValue({
      id: 'acct_1',
      email: 'alice@example.com',
      displayName: 'Alice',
      emailVerified: false,
      status: 'normal',
      passwordHash: 'hashed-password',
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/verify-email/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.verifyToken.deleteMany).toHaveBeenCalledWith({
      where: {
        cokeAccountId: 'acct_1',
        type: 'email_verify',
        used: false,
      },
    });
    expect(sendCokeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        html: expect.stringContaining('/coke/verify-email?token=plain-token&email=alice%40example.com'),
      }),
    );
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        message: 'If the account exists, a verification email has been sent.',
      },
    });
  });

  it('returns a generic resend response when the account is missing', async () => {
    db.cokeAccount.findUnique.mockResolvedValue(null);

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/verify-email/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'missing@example.com',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.verifyToken.deleteMany).not.toHaveBeenCalled();
    expect(sendCokeEmail).not.toHaveBeenCalled();
  });

  it('sends a password reset email when the account exists', async () => {
    db.cokeAccount.findUnique.mockResolvedValue({
      id: 'acct_1',
      email: 'alice@example.com',
      displayName: 'Alice',
      emailVerified: true,
      status: 'normal',
      passwordHash: 'hashed-password',
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/forgot-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.verifyToken.deleteMany).toHaveBeenCalledWith({
      where: {
        cokeAccountId: 'acct_1',
        type: 'password_reset',
        used: false,
      },
    });
    expect(sendCokeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        html: expect.stringContaining('/coke/reset-password?token=plain-token'),
      }),
    );
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        message: 'Password reset instructions were sent if the account exists.',
      },
    });
  });

  it('resets the password when the token is valid', async () => {
    db.verifyToken.findFirst.mockResolvedValue({
      id: 'vrt_2',
      cokeAccountId: 'acct_1',
      type: 'password_reset',
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
      account: {
        id: 'acct_1',
        email: 'alice@example.com',
        displayName: 'Alice',
        emailVerified: true,
        status: 'normal',
        passwordHash: 'hashed-password',
      },
    });
    tx.cokeAccount.update.mockResolvedValue({
      id: 'acct_1',
      email: 'alice@example.com',
      displayName: 'Alice',
      emailVerified: true,
      status: 'normal',
      passwordHash: 'hashed:new-password123',
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token: 'plain-token',
        password: 'new-password123',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.verifyToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: sha256Hex('plain-token'),
          type: 'password_reset',
          used: false,
        }),
      }),
    );
    expect(tx.cokeAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct_1' },
      data: { passwordHash: 'hashed:new-password123' },
    });
    expect(tx.verifyToken.update).toHaveBeenCalledWith({
      where: { id: 'vrt_2' },
      data: { used: true },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: null,
    });
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
