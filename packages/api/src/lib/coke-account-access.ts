import { buildRenewalUrl, getSubscriptionSnapshot } from './coke-subscription.js';

type CokeAccountAccessDeniedReason =
  | 'email_not_verified'
  | 'subscription_required'
  | 'account_suspended';

interface CokeAccountAccessDecision {
  accountStatus: 'normal' | 'suspended';
  emailVerified: boolean;
  subscriptionActive: boolean;
  subscriptionExpiresAt: string | null;
  accountAccessAllowed: boolean;
  accountAccessDeniedReason: CokeAccountAccessDeniedReason | null;
  renewalUrl: string;
}

interface ResolveCokeAccountAccessInput {
  account: {
    id: string;
    status: 'normal' | 'suspended';
    emailVerified: boolean;
    displayName?: string | null;
  };
  now?: Date;
  renewalUrl?: string;
  requireEmailVerified?: boolean;
}

export async function resolveCokeAccountAccess(
  input: ResolveCokeAccountAccessInput,
): Promise<CokeAccountAccessDecision> {
  const snapshot = await getSubscriptionSnapshot(input.account.id, input.now ?? new Date());
  const renewalUrl = input.renewalUrl ?? buildRenewalUrl();
  const requireEmailVerified = input.requireEmailVerified ?? true;

  if (input.account.status !== 'normal') {
    return {
      accountStatus: input.account.status,
      emailVerified: input.account.emailVerified,
      ...snapshot,
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'account_suspended',
      renewalUrl,
    };
  }

  if (requireEmailVerified && !input.account.emailVerified) {
    return {
      accountStatus: input.account.status,
      emailVerified: input.account.emailVerified,
      ...snapshot,
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'email_not_verified',
      renewalUrl,
    };
  }

  if (!snapshot.subscriptionActive) {
    return {
      accountStatus: input.account.status,
      emailVerified: input.account.emailVerified,
      ...snapshot,
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'subscription_required',
      renewalUrl,
    };
  }

  return {
    accountStatus: input.account.status,
    emailVerified: input.account.emailVerified,
    ...snapshot,
    accountAccessAllowed: true,
    accountAccessDeniedReason: null,
    renewalUrl,
  };
}
