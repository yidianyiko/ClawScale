import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const tx = vi.hoisted(() => ({
  identity: {
    update: vi.fn(),
  },
  customer: {
    create: vi.fn(),
  },
}));

const db = vi.hoisted(() => ({
  membership: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
}));

vi.mock('../db/index.js', () => ({ db }));

import { issueClaimToken } from '../lib/claim-token.js';
import { customerClaimRouter } from './customer-claim-routes.js';

describe('customer claim routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    tx.identity.update.mockResolvedValue({
      id: 'idt_123',
      email: 'alice@example.com',
      claimStatus: 'active',
    });
    db.membership.findFirst.mockResolvedValue({
      role: 'owner',
      customer: { id: 'ck_123' },
      identity: {
        id: 'idt_123',
        email: null,
        claimStatus: 'pending',
        updatedAt: new Date('2026-04-18T00:05:00.000Z'),
      },
    });
  });

  afterEach(() => {
    delete process.env.CUSTOMER_JWT_SECRET;
    delete process.env.COKE_JWT_SECRET;
    vi.useRealTimers();
  });

  it('completes a claim and returns the active customer auth payload', async () => {
    const issueTx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          updatedAt: new Date('2026-04-18T00:05:00.000Z'),
        }),
      },
    };
    const issueClient = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          role: 'owner',
          customer: { id: 'ck_123' },
          identity: {
            id: 'idt_123',
            email: null,
            claimStatus: 'unclaimed',
            updatedAt: new Date('2026-04-18T00:00:00.000Z'),
          },
        }),
      },
      $transaction: vi.fn(async (fn: (client: typeof issueTx) => Promise<unknown>) => fn(issueTx)),
    };
    const issued = await issueClaimToken(issueClient as never, {
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });

    const app = new Hono();
    app.route('/api/auth/claim', customerClaimRouter);

    const res = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token: issued.token,
        password: 'new-password123',
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

  it('rejects invalid or expired claim tokens without creating a new customer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));

    const issueTx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          updatedAt: new Date('2026-04-18T00:00:00.000Z'),
        }),
      },
    };
    const issueClient = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          role: 'owner',
          customer: { id: 'ck_123' },
          identity: {
            id: 'idt_123',
            email: null,
            claimStatus: 'unclaimed',
            updatedAt: new Date('2026-04-17T23:55:00.000Z'),
          },
        }),
      },
      $transaction: vi.fn(async (fn: (client: typeof issueTx) => Promise<unknown>) => fn(issueTx)),
    };
    const issued = await issueClaimToken(issueClient as never, {
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });


    db.membership.findFirst.mockResolvedValueOnce({
      role: 'owner',
      customer: { id: 'ck_123' },
      identity: {
        id: 'idt_123',
        email: null,
        claimStatus: 'pending',
        updatedAt: new Date('2026-04-18T00:00:00.000Z'),
      },
    });

    vi.setSystemTime(new Date('2026-04-18T00:16:00.000Z'));

    const app = new Hono();
    app.route('/api/auth/claim', customerClaimRouter);

    const res = await app.request('/api/auth/claim', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token: issued.token,
        password: 'new-password123',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_or_expired_token',
    });
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.identity.update).not.toHaveBeenCalled();
  });
});
