import { db } from '../db/index.js';

const ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface SubscriptionSnapshot {
  subscriptionActive: boolean;
  subscriptionExpiresAt: string | null;
}

export interface StackedAccessWindow {
  startsAt: string;
  expiresAt: string;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function calculateStackedAccessWindow(input: {
  now: Date;
  latestExpiresAt: Date | null;
}): StackedAccessWindow {
  const startsAt = input.latestExpiresAt && input.latestExpiresAt > input.now
    ? input.latestExpiresAt
    : input.now;

  const expiresAt = new Date(startsAt.getTime() + ACCESS_WINDOW_MS);

  return {
    startsAt: startsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getSubscriptionSnapshot(
  customerId: string,
  now = new Date(),
): Promise<SubscriptionSnapshot> {
  const latest = await db.subscription.findFirst({
    where: { customerId },
    orderBy: [{ expiresAt: 'desc' }],
    select: {
      expiresAt: true,
    },
  });

  return {
    subscriptionActive: !!latest?.expiresAt && latest.expiresAt > now,
    subscriptionExpiresAt: toIso(latest?.expiresAt),
  };
}

export function buildRenewalUrl(): string {
  const renewalUrl = process.env['COKE_RENEWAL_URL']?.trim();
  if (renewalUrl) {
    return renewalUrl;
  }

  const domainClient = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  return domainClient ? `${domainClient}/coke/renew` : '/coke/renew';
}
