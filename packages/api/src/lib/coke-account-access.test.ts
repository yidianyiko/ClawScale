import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  customer: {
    findUnique: vi.fn(),
  },
  subscription: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

import { resolveCokeAccountAccess } from './coke-account-access.js';

describe('resolveCokeAccountAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.customer.findUnique.mockResolvedValue({
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    });
  });

  it('returns subscription_required when the account is normal and verified but expired', async () => {
    db.subscription.findFirst.mockResolvedValue({
      expiresAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(
      resolveCokeAccountAccess({
        account: {
          id: 'acct_1',
          status: 'normal',
          emailVerified: true,
          displayName: 'Alice',
        },
        now: new Date('2026-05-10T00:00:00.000Z'),
        renewalUrl: 'https://coke.app/account/subscription',
      }),
    ).resolves.toMatchObject({
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'subscription_required',
    });
  });

  it('does not block on email verification when requireEmailVerified is false', async () => {
    db.subscription.findFirst.mockResolvedValue({
      expiresAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(
      resolveCokeAccountAccess({
        account: {
          id: 'acct_1',
          status: 'normal',
          emailVerified: false,
          displayName: 'Alice',
        },
        now: new Date('2026-05-10T00:00:00.000Z'),
        requireEmailVerified: false,
        renewalUrl: 'https://coke.app/api/public/subscription-checkout?token=signed',
      }),
    ).resolves.toMatchObject({
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'subscription_required',
      renewalUrl: 'https://coke.app/api/public/subscription-checkout?token=signed',
    });
  });
});
