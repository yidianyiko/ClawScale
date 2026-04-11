import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      getSubscriptionSnapshot('acct_1', new Date('2026-04-10T00:00:00.000Z')),
    ).resolves.toMatchObject({
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
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
