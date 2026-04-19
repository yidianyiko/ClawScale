import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  membership: {
    findFirst: vi.fn(),
  },
  cokeAccount: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  verifyToken: {
    create: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const ensureClawscaleUserForCustomer = vi.hoisted(() => vi.fn());
const sendCokeEmail = vi.hoisted(() => vi.fn());
const resolveCokeAccountAccess = vi.hoisted(() => vi.fn());
const verifyCokeToken = vi.hoisted(() => vi.fn());
const registerCustomer = vi.hoisted(() => vi.fn());
const authenticateCustomer = vi.hoisted(() => vi.fn());
const signCustomerToken = vi.hoisted(() => vi.fn(() => 'customer-session-token'));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/clawscale-user.js', () => ({
  ensureClawscaleUserForCustomer,
}));
vi.mock('../lib/email.js', () => ({ sendCokeEmail }));
vi.mock('../lib/coke-account-access.js', () => ({ resolveCokeAccountAccess }));
vi.mock('../lib/customer-auth.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/customer-auth.js')>(
    '../lib/customer-auth.js',
  );
  return {
    ...actual,
    registerCustomer,
    authenticateCustomer,
    signCustomerToken,
  };
});
vi.mock('../lib/coke-auth.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/coke-auth.js')>(
    '../lib/coke-auth.js',
  );
  return {
    ...actual,
    hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
    verifyPassword: vi.fn(async () => true),
    verifyCokeToken,
    issueVerifyToken: vi.fn(() => ({
      plainToken: 'plain-token',
      tokenHash: 'token-hash',
    })),
    signCokeToken: vi.fn(() => 'signed-token'),
  };
});

import { CustomerAuthError } from '../lib/customer-auth.js';
import { cokeAuthRouter } from './coke-auth-routes.js';

function expectDeprecationHeaders(response: Response, successorPath: string) {
  expect(response.headers.get('Deprecation')).toBe('true');
  expect(response.headers.get('Link')).toBe(`<${successorPath}>; rel="successor-version"`);
}

function makeOwnerMembership(input: {
  customerId: string;
  displayName: string;
  email: string;
  claimStatus: 'active' | 'pending' | 'unclaimed';
  identityId: string;
}) {
  return {
    role: 'owner',
    customer: {
      id: input.customerId,
      displayName: input.displayName,
    },
    identity: {
      id: input.identityId,
      email: input.email,
      claimStatus: input.claimStatus,
    },
  };
}

describe('coke auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_CLIENT = 'https://coke.example';
    resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://coke.example/coke/renew',
    });
    db.membership.findFirst.mockResolvedValue(
      makeOwnerMembership({
        customerId: 'ck_1',
        displayName: 'Alice',
        email: 'alice@example.com',
        claimStatus: 'active',
        identityId: 'idt_1',
      }),
    );
    authenticateCustomer.mockResolvedValue({
      customerId: 'ck_1',
      identityId: 'idt_1',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
      token: 'customer-token',
    });
    db.$transaction.mockImplementation(async (fn: (client: typeof db) => Promise<unknown>) =>
      fn(db),
    );
  });

  it.each([
    ['/register', '/api/auth/register', { displayName: 'Alice', email: 'alice@example.com', password: 'password123' }],
    ['/verify-email', '/api/auth/verify-email', { email: 'alice@example.com', token: 'plain-token' }],
    ['/verify-email/resend', '/api/auth/resend-verification', { email: 'alice@example.com' }],
    ['/forgot-password', '/api/auth/forgot-password', { email: 'alice@example.com' }],
    ['/reset-password', '/api/auth/reset-password', { token: 'plain-token', password: 'password123' }],
  ])('returns a paused response for %s', async (path, successorPath, body) => {
    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request(`/api/coke${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(503);
    expectDeprecationHeaders(res, successorPath);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'temporarily_paused',
    });
    expect(registerCustomer).not.toHaveBeenCalled();
    expect(authenticateCustomer).not.toHaveBeenCalled();
    expect(ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    expect(sendCokeEmail).not.toHaveBeenCalled();
    expect(db.cokeAccount.findUnique).not.toHaveBeenCalled();
    expect(db.cokeAccount.create).not.toHaveBeenCalled();
    expect(db.cokeAccount.update).not.toHaveBeenCalled();
    expect(db.verifyToken.create).not.toHaveBeenCalled();
    expect(db.verifyToken.findFirst).not.toHaveBeenCalled();
    expect(db.verifyToken.deleteMany).not.toHaveBeenCalled();
  });

  it('logs in through the neutral customer graph and does not use legacy fallback', async () => {
    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'Alice@Example.com',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(200);
    expectDeprecationHeaders(res, '/api/auth/login');
    expect(authenticateCustomer).toHaveBeenCalledWith(db, {
      email: 'Alice@Example.com',
      password: 'password123',
    });
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_1',
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            displayName: true,
            id: true,
          },
        },
        identity: {
          select: {
            claimStatus: true,
            email: true,
            id: true,
          },
        },
      },
    });
    expect(db.cokeAccount.findUnique).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        token: 'signed-token',
        user: {
          id: 'ck_1',
          email: 'alice@example.com',
          display_name: 'Alice',
          email_verified: true,
          status: 'normal',
          subscription_active: true,
          subscription_expires_at: '2026-05-10T00:00:00.000Z',
        },
        customerAuth: {
          token: 'customer-token',
          customerId: 'ck_1',
          identityId: 'idt_1',
          claimStatus: 'active',
          email: 'alice@example.com',
          membershipRole: 'owner',
        },
      },
    });
  });

  it('rejects legacy-only login instead of falling back to Coke account storage', async () => {
    authenticateCustomer.mockRejectedValueOnce(new CustomerAuthError('invalid_credentials'));
    db.cokeAccount.findUnique.mockResolvedValue({
      id: 'acct_legacy',
      email: 'legacy@example.com',
      displayName: 'Legacy User',
      emailVerified: true,
      status: 'normal',
      passwordHash: 'hashed-password',
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'legacy@example.com',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(401);
    expectDeprecationHeaders(res, '/api/auth/login');
    expect(db.cokeAccount.findUnique).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
  });

  it('returns the current Coke profile from neutral membership data for /me', async () => {
    verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
    });

    const app = new Hono();
    app.route('/api/coke', cokeAuthRouter);

    const res = await app.request('/api/coke/me', {
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(200);
    expectDeprecationHeaders(res, '/api/auth/me');
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_1',
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            displayName: true,
            id: true,
          },
        },
        identity: {
          select: {
            claimStatus: true,
            email: true,
            id: true,
          },
        },
      },
    });
    expect(db.cokeAccount.findUnique).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'ck_1',
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
