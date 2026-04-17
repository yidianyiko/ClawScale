import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyCustomerToken } from './customer-auth.js';
import { completeCustomerClaim, issueClaimToken } from './claim-token.js';

describe('claim-token helpers', () => {
  afterEach(() => {
    delete process.env.CUSTOMER_JWT_SECRET;
    delete process.env.COKE_JWT_SECRET;
    vi.useRealTimers();
  });

  it('issuing a claim token marks the identity pending and returns the emailed token', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const issuedAt = new Date('2026-04-18T00:05:00.000Z');
    const tx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ updatedAt: issuedAt }),
      },
    };
    const client = {
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
      $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await issueClaimToken(client as never, {
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: ' Alice@Example.com ',
    });

    expect(client.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_123',
        identityId: 'idt_123',
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            id: true,
          },
        },
        identity: {
          select: {
            claimStatus: true,
            email: true,
            id: true,
            updatedAt: true,
          },
        },
      },
    });
    expect(tx.identity.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'idt_123',
        claimStatus: {
          in: ['unclaimed', 'pending'],
        },
      },
      data: {
        claimStatus: 'pending',
      },
    });
    expect(tx.identity.findUnique).toHaveBeenCalledWith({
      where: { id: 'idt_123' },
      select: {
        updatedAt: true,
      },
    });
    expect(result).toEqual({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'pending',
      email: 'alice@example.com',
      token: expect.any(String),
    });
  });


  it('rejects issuing a claim token for identities that are already active', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const tx = {
      identity: {
        updateMany: vi.fn(),
        findUnique: vi.fn(),
      },
    };
    const client = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          role: 'owner',
          customer: { id: 'ck_123' },
          identity: {
            id: 'idt_123',
            email: 'alice@example.com',
            claimStatus: 'active',
            updatedAt: new Date('2026-04-18T00:00:00.000Z'),
          },
        }),
      },
      $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(
      issueClaimToken(client as never, {
        customerId: 'ck_123',
        identityId: 'idt_123',
        email: 'alice@example.com',
      }),
    ).rejects.toMatchObject({ code: 'claim_not_allowed' });
    expect(tx.identity.updateMany).not.toHaveBeenCalled();
  });


  it('rejects issuing a claim token when the identity becomes active before the pending transition commits', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const tx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn(),
      },
    };
    const client = {
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
      $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(
      issueClaimToken(client as never, {
        customerId: 'ck_123',
        identityId: 'idt_123',
        email: 'alice@example.com',
      }),
    ).rejects.toMatchObject({ code: 'claim_not_allowed' });
    expect(tx.identity.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'idt_123',
        claimStatus: {
          in: ['unclaimed', 'pending'],
        },
      },
      data: {
        claimStatus: 'pending',
      },
    });
    expect(tx.identity.findUnique).not.toHaveBeenCalled();
  });


  it('rejects issuing a claim token when the claimed identity disappears after the pending transition', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const tx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const client = {
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
      $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    await expect(
      issueClaimToken(client as never, {
        customerId: 'ck_123',
        identityId: 'idt_123',
        email: 'alice@example.com',
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' });
    expect(tx.identity.findUnique).toHaveBeenCalledOnce();
  });

  it('completing a claim writes credentials onto the existing customer and flips the claim active', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const pendingAt = new Date('2026-04-18T00:05:00.000Z');
    const issueTx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ updatedAt: pendingAt }),
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
      $transaction: vi.fn(async (fn: (db: typeof issueTx) => Promise<unknown>) => fn(issueTx)),
    };
    const issued = await issueClaimToken(issueClient as never, {
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });

    const completeTx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const completeClient = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          role: 'owner',
          customer: { id: 'ck_123' },
          identity: {
            id: 'idt_123',
            email: null,
            claimStatus: 'pending',
            updatedAt: pendingAt,
          },
        }),
      },
      $transaction: vi.fn(async (fn: (db: typeof completeTx) => Promise<unknown>) => fn(completeTx)),
    };

    const result = await completeCustomerClaim(completeClient as never, {
      token: issued.token,
      password: 'new-password123',
    });

    expect(completeTx.identity.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'idt_123',
        claimStatus: 'pending',
        updatedAt: pendingAt,
      },
      data: {
        email: 'alice@example.com',
        passwordHash: expect.any(String),
        claimStatus: 'active',
      },
    });
    expect(result).toEqual({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
      token: expect.any(String),
    });
    expect(verifyCustomerToken(result.token)).toMatchObject({
      sub: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });
  });

  it('rejects completing a claim when a concurrent submission already consumed the token', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const pendingAt = new Date('2026-04-18T00:05:00.000Z');
    const issueTx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ updatedAt: pendingAt }),
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
      $transaction: vi.fn(async (fn: (db: typeof issueTx) => Promise<unknown>) => fn(issueTx)),
    };
    const issued = await issueClaimToken(issueClient as never, {
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });

    const completeTx = {
      identity: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const completeClient = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          role: 'owner',
          customer: { id: 'ck_123' },
          identity: {
            id: 'idt_123',
            email: null,
            claimStatus: 'pending',
            updatedAt: pendingAt,
          },
        }),
      },
      $transaction: vi.fn(async (fn: (db: typeof completeTx) => Promise<unknown>) => fn(completeTx)),
    };

    await expect(
      completeCustomerClaim(completeClient as never, {
        token: issued.token,
        password: 'new-password123',
      }),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_token' });
    expect(completeTx.identity.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'idt_123',
        claimStatus: 'pending',
        updatedAt: pendingAt,
      },
      data: {
        email: 'alice@example.com',
        passwordHash: expect.any(String),
        claimStatus: 'active',
      },
    });
  });
});
