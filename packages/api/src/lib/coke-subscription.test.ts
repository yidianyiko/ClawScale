import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const retirementMigrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260417020000_retire_coke_auth_storage/migration.sql',
);

const db = vi.hoisted(() => ({
  subscription: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

import {
  calculateStackedAccessWindow,
  getSubscriptionSnapshot,
} from './coke-subscription.js';

describe('coke-subscription helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a future subscription as active', async () => {
    db.subscription.findFirst.mockResolvedValue({
      expiresAt: new Date('2026-05-10T00:00:00.000Z'),
    });

    await expect(
      getSubscriptionSnapshot('ck_1', new Date('2026-04-10T00:00:00.000Z')),
    ).resolves.toMatchObject({
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
    });
    expect(db.subscription.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'ck_1' },
      orderBy: [{ expiresAt: 'desc' }],
      select: {
        expiresAt: true,
      },
    });
  });

  it('stacks from the previous expiry when access is still active', () => {
    expect(
      calculateStackedAccessWindow({
        now: new Date('2026-04-10T00:00:00.000Z'),
        latestExpiresAt: new Date('2026-04-20T00:00:00.000Z'),
      }),
    ).toEqual({
      startsAt: '2026-04-20T00:00:00.000Z',
      expiresAt: '2026-05-20T00:00:00.000Z',
    });
  });
});

describe('coke subscription migration guard', () => {
  it('makes legacy coke_account_id non-blocking while customer_id becomes authoritative', () => {
    const migration = readFileSync(retirementMigrationPath, 'utf8').replace(/\s+/g, ' ');

    expect(migration).toContain('ADD COLUMN "customer_id" TEXT');
    expect(migration).toContain('SET "customer_id" = "coke_account_id"');
    expect(migration).toContain('ALTER COLUMN "customer_id" SET NOT NULL');
    expect(migration).toContain('ALTER COLUMN "coke_account_id" DROP NOT NULL');
    expect(migration).not.toContain('DROP COLUMN "coke_account_id"');
  });
});
