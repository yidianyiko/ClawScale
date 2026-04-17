import { afterEach, describe, expect, it, vi } from 'vitest';

import { signCustomerToken } from './customer-auth.js';
import {
  AdminAuthError,
  authenticateAdmin,
  hashAdminPassword,
  normalizeAdminEmail,
  verifyAdminToken,
} from './admin-auth.js';

describe('admin-auth helpers', () => {
  afterEach(() => {
    delete process.env.ADMIN_JWT_SECRET;
    delete process.env.CUSTOMER_JWT_SECRET;
    delete process.env.COKE_JWT_SECRET;
  });

  it('normalizes admin email deterministically', () => {
    expect(normalizeAdminEmail('  Admin@Example.COM ')).toBe('admin@example.com');
  });

  it('admin login succeeds only with AdminAccount', async () => {
    process.env.ADMIN_JWT_SECRET = 'admin-secret';
    const passwordHash = await hashAdminPassword('password123');
    const client = {
      adminAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'adm_123',
          email: 'admin@example.com',
          passwordHash,
          isActive: true,
          createdAt: new Date('2026-04-16T00:00:00.000Z'),
          updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        }),
      },
    };

    const result = await authenticateAdmin(client as never, {
      email: ' Admin@Example.com ',
      password: 'password123',
    });

    expect(client.adminAccount.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
    });
    expect(result).toEqual({
      adminId: 'adm_123',
      email: 'admin@example.com',
      isActive: true,
      token: expect.any(String),
    });
    expect(verifyAdminToken(result.token)).toMatchObject({
      sub: 'adm_123',
      email: 'admin@example.com',
      tokenType: 'admin',
    });
  });

  it('rejects customer credentials when no AdminAccount exists for that email', async () => {
    const client = {
      adminAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
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
              passwordHash: await hashAdminPassword('password123'),
            },
          },
        ]),
      },
    };

    await expect(
      authenticateAdmin(client as never, {
        email: 'alice@example.com',
        password: 'password123',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
    } satisfies Partial<AdminAuthError>);
    expect(client.adminAccount.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
    expect(client.membership.findMany).not.toHaveBeenCalled();
  });

  it('inactive admins cannot log in', async () => {
    const passwordHash = await hashAdminPassword('password123');
    const client = {
      adminAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'adm_123',
          email: 'admin@example.com',
          passwordHash,
          isActive: false,
        }),
      },
    };

    await expect(
      authenticateAdmin(client as never, {
        email: 'admin@example.com',
        password: 'password123',
      }),
    ).rejects.toMatchObject({
      code: 'inactive_account',
    } satisfies Partial<AdminAuthError>);
  });

  it('rejects customer tokens when verifying admin access', () => {
    process.env.ADMIN_JWT_SECRET = 'admin-secret';
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    const customerToken = signCustomerToken({
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });

    expect(() => verifyAdminToken(customerToken)).toThrow('invalid_or_expired_token');
  });
});
