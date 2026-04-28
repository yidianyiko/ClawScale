import { db } from '../db/index.js';

const ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TRIAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface SubscriptionSnapshot {
  subscriptionActive: boolean;
  subscriptionExpiresAt: string | null;
}

interface StackedAccessWindow {
  startsAt: string;
  expiresAt: string;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function calculateTrialExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TRIAL_WINDOW_MS);
}

function resolveLatestAccessExpiry(input: {
  latestSubscriptionExpiresAt: Date | null;
  customerCreatedAt: Date | null;
}): Date | null {
  const trialExpiresAt = input.customerCreatedAt
    ? calculateTrialExpiresAt(input.customerCreatedAt)
    : null;

  if (input.latestSubscriptionExpiresAt && trialExpiresAt) {
    return input.latestSubscriptionExpiresAt > trialExpiresAt
      ? input.latestSubscriptionExpiresAt
      : trialExpiresAt;
  }

  return input.latestSubscriptionExpiresAt ?? trialExpiresAt;
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
  const [customer, latest] = await Promise.all([
    db.customer.findUnique({
      where: { id: customerId },
      select: {
        createdAt: true,
      },
    }),
    db.subscription.findFirst({
      where: { customerId },
      orderBy: [{ expiresAt: 'desc' }],
      select: {
        expiresAt: true,
      },
    }),
  ]);

  const accessExpiresAt = resolveLatestAccessExpiry({
    latestSubscriptionExpiresAt: latest?.expiresAt ?? null,
    customerCreatedAt: customer?.createdAt ?? null,
  });

  return {
    subscriptionActive: !!accessExpiresAt && accessExpiresAt > now,
    subscriptionExpiresAt: toIso(accessExpiresAt),
  };
}

export function buildRenewalUrl(): string {
  const renewalUrl = process.env['COKE_RENEWAL_URL']?.trim();
  if (renewalUrl) {
    return renewalUrl;
  }

  const domainClient = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  return domainClient ? `${domainClient}/account/subscription` : '/account/subscription';
}
