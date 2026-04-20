import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const tx = vi.hoisted(() => ({
  identity: {
    create: vi.fn(),
    update: vi.fn(),
  },
  customer: {
    create: vi.fn(),
  },
  membership: {
    create: vi.fn(),
  },
}));

const db = vi.hoisted(() => ({
  identity: {
    findUnique: vi.fn(),
  },
  membership: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
}));

const sendCustomerVerificationEmail = vi.hoisted(() => vi.fn());
const sendCustomerPasswordResetEmail = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/customer-email.js', () => ({
  sendCustomerVerificationEmail,
  sendCustomerPasswordResetEmail,
}));

import {
  hashPassword,
  issueCustomerActionToken,
  signCustomerToken,
} from '../lib/customer-auth.js';
import { customerAuthRouter } from './customer-auth-routes.js';

describe('customer auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    tx.identity.create.mockResolvedValue({
      id: 'idt_123',
      email: 'alice@example.com',
      displayName: 'Alice',
      claimStatus: 'pending',
    });
    tx.customer.create.mockImplementation(async ({ data }: { data: { id: string; displayName: string } }) => ({
      id: data.id,
      kind: 'personal',
      displayName: data.displayName,
    }));
    tx.membership.create.mockResolvedValue({
      id: 'mbr_123',
      identityId: 'idt_123',
      customerId: 'ck_generated',
      role: 'owner',
    });
    db.membership.findMany.mockResolvedValue([
      {
        role: 'owner',
        customer: { id: 'ck_generated' },
        identity: {
          id: 'idt_123',
          email: 'alice@example.com',
          claimStatus: 'pending',
          passwordHash: 'hashed-password',
          updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        },
      },
    ]);
    sendCustomerVerificationEmail.mockResolvedValue(undefined);
    sendCustomerPasswordResetEmail.mockResolvedValue(undefined);
  });

  it('registers a neutral customer identity graph', async () => {
    db.identity.findUnique.mockResolvedValue(null);

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/register', {
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
    expect(db.identity.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
      select: { id: true },
    });
    expect(tx.identity.create).toHaveBeenCalledWith({
      data: {
        email: 'alice@example.com',
        displayName: 'Alice',
        passwordHash: expect.any(String),
        claimStatus: 'pending',
      },
    });
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        kind: 'personal',
        displayName: 'Alice',
      }),
    });
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: {
        identityId: 'idt_123',
        customerId: expect.any(String),
        role: 'owner',
      },
    });
    expect(sendCustomerVerificationEmail).toHaveBeenCalledWith({
      to: 'alice@example.com',
      email: 'alice@example.com',
      token: expect.any(String),
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        customerId: expect.any(String),
        identityId: 'idt_123',
        claimStatus: 'pending',
        email: 'alice@example.com',
        membershipRole: 'owner',
        token: expect.any(String),
      },
    });
  });

  it('still returns the auth payload when verification email delivery fails during registration', async () => {
    db.identity.findUnique.mockResolvedValue(null);
    sendCustomerVerificationEmail.mockRejectedValueOnce(new Error('smtp down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/register', {
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
    expect(sendCustomerVerificationEmail).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      '[customer-auth] failed to send verification email after registration',
      expect.objectContaining({
        customerId: expect.any(String),
        email: 'alice@example.com',
      }),
    );
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        customerId: expect.any(String),
        identityId: 'idt_123',
        claimStatus: 'pending',
        email: 'alice@example.com',
        membershipRole: 'owner',
        token: expect.any(String),
      },
    });

    errorSpy.mockRestore();
  });

  it('still returns the auth payload when post-registration email lookup fails', async () => {
    db.identity.findUnique.mockResolvedValue(null);
    db.membership.findMany.mockRejectedValueOnce(new Error('lookup down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/register', {
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
    expect(errorSpy).toHaveBeenCalledWith(
      '[customer-auth] failed to send verification email after registration',
      expect.objectContaining({
        email: 'alice@example.com',
      }),
    );
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        customerId: expect.any(String),
        identityId: 'idt_123',
        claimStatus: 'pending',
        email: 'alice@example.com',
        membershipRole: 'owner',
        token: expect.any(String),
      },
    });

    errorSpy.mockRestore();
  });

  it('logs in by identity email and returns the current customer session', async () => {
    const passwordHash = await hashPassword('password123');
    db.membership.findMany.mockResolvedValue([
      {
        role: 'owner',
        customer: {
          id: 'ck_123',
        },
        identity: {
          id: 'idt_123',
          email: 'alice@example.com',
          claimStatus: 'active',
          passwordHash,
        },
      },
    ]);

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/login', {
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
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        customerId: 'ck_123',
        identityId: 'idt_123',
        claimStatus: 'active',
        email: 'alice@example.com',
        membershipRole: 'owner',
        token: expect.any(String),
      },
    });
  });

  it('verifies email against the platform-owned identity graph', async () => {
    const updatedAt = new Date('2026-04-16T00:00:00.000Z');
    const verifyToken = issueCustomerActionToken({
      purpose: 'verify_email',
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
      updatedAt,
    });
    db.membership.findFirst.mockResolvedValue({
      role: 'owner',
      customer: {
        id: 'ck_123',
      },
      identity: {
        id: 'idt_123',
        email: 'alice@example.com',
        claimStatus: 'pending',
        updatedAt,
      },
    });
    tx.identity.update.mockResolvedValue({
      id: 'idt_123',
      email: 'alice@example.com',
      claimStatus: 'active',
      updatedAt: new Date('2026-04-16T00:05:00.000Z'),
    });

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/verify-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
        token: verifyToken,
      }),
    });

    expect(res.status).toBe(200);
    expect(tx.identity.update).toHaveBeenCalledWith({
      where: { id: 'idt_123' },
      data: {
        claimStatus: 'active',
      },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        customerId: 'ck_123',
        identityId: 'idt_123',
        claimStatus: 'active',
        email: 'alice@example.com',
        membershipRole: 'owner',
        token: expect.any(String),
      },
    });
  });

  it('resets the password against the platform-owned identity table', async () => {
    const passwordHash = await hashPassword('old-password123');
    const resetToken = issueCustomerActionToken({
      purpose: 'password_reset',
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
      passwordHash,
    });
    db.membership.findFirst.mockResolvedValue({
      role: 'owner',
      customer: {
        id: 'ck_123',
      },
      identity: {
        id: 'idt_123',
        email: 'alice@example.com',
        claimStatus: 'active',
        passwordHash,
        updatedAt: new Date('2026-04-16T00:00:00.000Z'),
      },
    });
    tx.identity.update.mockResolvedValue({
      id: 'idt_123',
      email: 'alice@example.com',
      claimStatus: 'active',
    });

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token: resetToken,
        password: 'new-password123',
      }),
    });

    expect(res.status).toBe(200);
    expect(tx.identity.update).toHaveBeenCalledWith({
      where: { id: 'idt_123' },
      data: {
        passwordHash: expect.any(String),
      },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: null,
    });
  });

  it('returns invalid_or_expired_token for malformed verify-email tokens', async () => {
    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/verify-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
        token: 'bad-token',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_or_expired_token',
    });
  });

  it('returns invalid_or_expired_token for malformed reset-password tokens', async () => {
    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token: 'bad-token',
        password: 'new-password123',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_or_expired_token',
    });
  });

  it('resends a neutral verification email when the identity exists', async () => {
    db.membership.findMany.mockResolvedValue([
      {
        role: 'owner',
        customer: { id: 'ck_123' },
        identity: {
          id: 'idt_123',
          email: 'alice@example.com',
          claimStatus: 'active',
          updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        },
      },
    ]);

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/resend-verification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
      }),
    });

    expect(res.status).toBe(200);
    expect(sendCustomerVerificationEmail).toHaveBeenCalledWith({
      to: 'alice@example.com',
      email: 'alice@example.com',
      token: expect.any(String),
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        message: 'If the account exists, a verification email has been sent.',
      },
    });
  });

  it('keeps a blind response when resend-verification delivery fails', async () => {
    db.membership.findMany.mockResolvedValue([
      {
        role: 'owner',
        customer: { id: 'ck_123' },
        identity: {
          id: 'idt_123',
          email: 'alice@example.com',
          claimStatus: 'active',
          updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        },
      },
    ]);
    sendCustomerVerificationEmail.mockRejectedValueOnce(new Error('smtp down'));

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/resend-verification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        message: 'If the account exists, a verification email has been sent.',
      },
    });
  });

  it('sends a neutral password reset email when the identity exists', async () => {
    const passwordHash = await hashPassword('old-password123');
    db.membership.findMany.mockResolvedValue([
      {
        role: 'owner',
        customer: { id: 'ck_123' },
        identity: {
          id: 'idt_123',
          email: 'alice@example.com',
          claimStatus: 'active',
          passwordHash,
          updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        },
      },
    ]);

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
      }),
    });

    expect(res.status).toBe(200);
    expect(sendCustomerPasswordResetEmail).toHaveBeenCalledWith({
      to: 'alice@example.com',
      token: expect.any(String),
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        message: 'Password reset instructions were sent if the account exists.',
      },
    });
  });

  it('keeps a blind response when forgot-password delivery fails', async () => {
    const passwordHash = await hashPassword('old-password123');
    db.membership.findMany.mockResolvedValue([
      {
        role: 'owner',
        customer: { id: 'ck_123' },
        identity: {
          id: 'idt_123',
          email: 'alice@example.com',
          claimStatus: 'active',
          passwordHash,
          updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        },
      },
    ]);
    sendCustomerPasswordResetEmail.mockRejectedValueOnce(new Error('smtp down'));

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        message: 'Password reset instructions were sent if the account exists.',
      },
    });
  });

  it('returns customer identity ownership data from /me', async () => {
    const accessToken = signCustomerToken({
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });
    db.membership.findFirst.mockResolvedValue({
      role: 'owner',
      customer: {
        id: 'ck_123',
      },
      identity: {
        id: 'idt_123',
        email: 'alice@example.com',
        claimStatus: 'pending',
      },
    });

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/me', {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        customerId: 'ck_123',
        identityId: 'idt_123',
        claimStatus: 'pending',
        email: 'alice@example.com',
        membershipRole: 'owner',
      },
    });
  });

  it('rejects action tokens on /me', async () => {
    const actionToken = issueCustomerActionToken({
      purpose: 'verify_email',
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/me', {
      headers: {
        authorization: `Bearer ${actionToken}`,
      },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_or_expired_token',
    });
  });

  it('returns 409 when registration races with an existing identity email', async () => {
    db.identity.findUnique.mockResolvedValue(null);
    tx.identity.create.mockRejectedValue({
      code: 'P2002',
      meta: {
        target: ['email'],
      },
    });

    const app = new Hono();
    app.route('/api/auth', customerAuthRouter);

    const res = await app.request('/api/auth/register', {
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
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'email_already_exists',
    });
  });
});
