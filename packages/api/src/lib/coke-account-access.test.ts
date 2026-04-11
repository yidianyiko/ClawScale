import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  subscription: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

import { resolveCokeAccountAccess } from './coke-account-access.js';

describe('resolveCokeAccountAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        now: new Date('2026-04-10T00:00:00.000Z'),
        renewalUrl: 'https://coke.app/coke/renew',
      }),
    ).resolves.toMatchObject({
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'subscription_required',
    });
  });
});
