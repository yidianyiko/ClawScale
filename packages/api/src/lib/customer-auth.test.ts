import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CustomerAuthError,
  authenticateCustomer,
  getCustomerSession,
  hashPassword,
  issueCustomerActionToken,
  normalizeEmail,
  registerCustomer,
  resetCustomerPassword,
  signCustomerToken,
  verifyCustomerEmail,
  verifyCustomerToken,
} from './customer-auth.js';

describe('customer-auth helpers', () => {
  afterEach(() => {
    delete process.env.CUSTOMER_JWT_SECRET;
    delete process.env.COKE_JWT_SECRET;
  });

  it('normalizes email deterministically', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('fails fast when no customer JWT secret is configured', () => {
    delete process.env.CUSTOMER_JWT_SECRET;
    delete process.env.COKE_JWT_SECRET;

    expect(() =>
      signCustomerToken({
        customerId: 'ck_123',
        identityId: 'idt_123',
        email: 'alice@example.com',
      }),
    ).toThrow('CUSTOMER_JWT_SECRET or COKE_JWT_SECRET is required');
  });

  it('rejects action tokens when verifying customer access tokens', () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    const actionToken = issueCustomerActionToken({
      purpose: 'verify_email',
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });

    expect(() => verifyCustomerToken(actionToken)).toThrow('invalid_or_expired_token');
  });

  it('registers a personal customer graph and returns the customer auth payload', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const tx = {
      identity: {
        create: vi.fn().mockResolvedValue({
          id: 'idt_123',
          email: 'alice@example.com',
          displayName: 'Alice',
          claimStatus: 'pending',
        }),
      },
      customer: {
        create: vi.fn().mockImplementation(async ({ data }: { data: { id: string; displayName: string } }) => ({
          id: data.id,
          kind: 'personal',
          displayName: data.displayName,
        })),
      },
      membership: {
        create: vi.fn().mockResolvedValue({
          id: 'mbr_123',
          identityId: 'idt_123',
          customerId: 'ck_generated',
          role: 'owner',
        }),
      },
    };

    const client = {
      identity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await registerCustomer(client as never, {
      displayName: ' Alice ',
      email: ' Alice@Example.com ',
      password: 'password123',
    });

    expect(client.identity.findUnique).toHaveBeenCalledWith({
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
    expect(result).toEqual({
      customerId: expect.any(String),
      identityId: 'idt_123',
      claimStatus: 'pending',
      email: 'alice@example.com',
      membershipRole: 'owner',
      token: expect.any(String),
    });
    expect(verifyCustomerToken(result.token)).toMatchObject({
      sub: result.customerId,
      identityId: 'idt_123',
      email: 'alice@example.com',
    });
  });

  it('authenticates a customer by identity email and returns the current membership', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    const passwordHash = await hashPassword('password123');
    const client = {
      membership: {
        findMany: vi.fn().mockResolvedValue([
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
        ]),
      },
    };

    const result = await authenticateCustomer(client as never, {
      email: ' Alice@Example.com ',
      password: 'password123',
    });

    expect(client.membership.findMany).toHaveBeenCalledWith({
      where: {
        role: 'owner',
        identity: {
          email: 'alice@example.com',
        },
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
            passwordHash: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 2,
    });
    expect(result).toEqual({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
      token: expect.any(String),
    });
  });

  it('rejects login when an identity email matches multiple owner memberships', async () => {
    const passwordHash = await hashPassword('password123');
    const client = {
      membership: {
        findMany: vi.fn().mockResolvedValue([
          {
            role: 'owner',
            customer: { id: 'ck_123' },
            identity: {
              id: 'idt_123',
              email: 'alice@example.com',
              claimStatus: 'active',
              passwordHash,
            },
          },
          {
            role: 'owner',
            customer: { id: 'ck_456' },
            identity: {
              id: 'idt_123',
              email: 'alice@example.com',
              claimStatus: 'active',
              passwordHash,
            },
          },
        ]),
      },
    };

    await expect(
      authenticateCustomer(client as never, {
        email: 'alice@example.com',
        password: 'password123',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
    } satisfies Partial<CustomerAuthError>);
  });

  it('loads the current customer session by customer and identity identifiers', async () => {
    const client = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          role: 'owner',
          customer: {
            id: 'ck_123',
          },
          identity: {
            id: 'idt_123',
            email: 'alice@example.com',
            claimStatus: 'pending',
          },
        }),
      },
    };

    const result = await getCustomerSession(client as never, {
      customerId: 'ck_123',
      identityId: 'idt_123',
    });

    expect(client.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_123',
        identityId: 'idt_123',
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
          },
        },
      },
    });
    expect(result).toEqual({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'pending',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
  });

  it('verifies email by consuming the current platform fingerprint', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    const initialUpdatedAt = new Date('2026-04-16T00:00:00.000Z');
    const consumedUpdatedAt = new Date('2026-04-16T00:05:00.000Z');
    const tx = {
      identity: {
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: 'idt_123',
          claimStatus: 'active',
        }),
      },
      customer: {
        create: vi.fn(),
      },
      membership: {
        create: vi.fn(),
      },
    };
    const client = {
      membership: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            role: 'owner',
            customer: { id: 'ck_123' },
            identity: {
              id: 'idt_123',
              email: 'alice@example.com',
              claimStatus: 'pending',
              updatedAt: initialUpdatedAt,
            },
          })
          .mockResolvedValueOnce({
            role: 'owner',
            customer: { id: 'ck_123' },
            identity: {
              id: 'idt_123',
              email: 'alice@example.com',
              claimStatus: 'active',
              updatedAt: consumedUpdatedAt,
            },
          }),
      },
      $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const token = issueCustomerActionToken({
      purpose: 'verify_email',
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
      updatedAt: initialUpdatedAt,
    });

    await expect(
      verifyCustomerEmail(client as never, {
        email: 'alice@example.com',
        token,
      }),
    ).resolves.toMatchObject({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
    expect(tx.identity.update).toHaveBeenCalledWith({
      where: { id: 'idt_123' },
      data: {
        claimStatus: 'active',
      },
    });
    await expect(
      verifyCustomerEmail(client as never, {
        email: 'alice@example.com',
        token,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_or_expired_token',
    } satisfies Partial<CustomerAuthError>);
  });

  it('resets the password using the current platform password fingerprint', async () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    const tx = {
      identity: {
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: 'idt_123',
        }),
      },
      customer: {
        create: vi.fn(),
      },
      membership: {
        create: vi.fn(),
      },
    };
    const passwordHash = await hashPassword('old-password123');
    const client = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({
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
        }),
      },
      $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const token = issueCustomerActionToken({
      purpose: 'password_reset',
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
      passwordHash,
    });

    await expect(
      resetCustomerPassword(client as never, {
        token,
        password: 'new-password123',
      }),
    ).resolves.toBeUndefined();
    expect(client.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_123',
        identityId: 'idt_123',
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
            passwordHash: true,
            updatedAt: true,
          },
        },
      },
    });
    expect(tx.identity.update).toHaveBeenCalledWith({
      where: { id: 'idt_123' },
      data: {
        passwordHash: expect.any(String),
      },
    });
  });
});
