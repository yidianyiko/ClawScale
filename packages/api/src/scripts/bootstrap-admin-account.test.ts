import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn(),
  adminAccount: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

const db = vi.hoisted(() => ({
  adminAccount: {
    count: vi.fn().mockResolvedValue(1),
  },
  $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  $disconnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/index.js', () => ({ db }));

import {
  MIN_BOOTSTRAP_PASSWORD_LENGTH,
  bootstrapAdminAccount,
} from './bootstrap-admin-account.js';

describe('bootstrap admin account script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    tx.$executeRawUnsafe.mockResolvedValue(1);
    tx.adminAccount.findFirst.mockResolvedValue(null);
    tx.adminAccount.create.mockResolvedValue({
      id: 'adm_123',
      email: 'admin@example.com',
      isActive: true,
    });
  });

  it('rejects bootstrap passwords shorter than the auth minimum', async () => {
    await expect(
      bootstrapAdminAccount(db as never, {
        ADMIN_BOOTSTRAP_EMAIL: 'admin@example.com',
        ADMIN_BOOTSTRAP_PASSWORD: 'short7',
      }),
    ).rejects.toThrow(`ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters`);

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('creates the first admin while holding the bootstrap lock', async () => {
    const events: string[] = [];
    tx.$executeRawUnsafe.mockImplementation(async () => {
      events.push('lock');
      return 1;
    });
    tx.adminAccount.findFirst.mockImplementation(async () => {
      events.push('findFirst');
      return null;
    });
    tx.adminAccount.create.mockImplementation(async ({ data }: { data: { email: string } }) => {
      events.push('create');
      return {
        id: 'adm_123',
        email: data.email,
        isActive: true,
      };
    });

    const result = await bootstrapAdminAccount(db as never, {
      ADMIN_BOOTSTRAP_EMAIL: ' Admin@Example.com ',
      ADMIN_BOOTSTRAP_PASSWORD: 'password123',
    });

    expect(result).toEqual({
      status: 'created',
      account: {
        id: 'adm_123',
        email: 'admin@example.com',
        isActive: true,
      },
    });
    expect(events).toEqual(['lock', 'findFirst', 'create']);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)',
      expect.any(Number),
    );
    expect(tx.adminAccount.create).toHaveBeenCalledWith({
      data: {
        email: 'admin@example.com',
        passwordHash: expect.any(String),
        isActive: true,
      },
    });
  });

  it('skips creation when an admin already exists after the lock is acquired', async () => {
    tx.adminAccount.findFirst.mockResolvedValue({
      id: 'adm_existing',
      email: 'existing@example.com',
      isActive: true,
    });

    const result = await bootstrapAdminAccount(db as never, {
      ADMIN_BOOTSTRAP_EMAIL: 'admin@example.com',
      ADMIN_BOOTSTRAP_PASSWORD: 'password123',
    });

    expect(result).toEqual({
      status: 'skipped',
      existingAccount: {
        id: 'adm_existing',
        email: 'existing@example.com',
        isActive: true,
      },
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledOnce();
    expect(tx.adminAccount.create).not.toHaveBeenCalled();
  });
});
