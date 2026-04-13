import { buildRenewalUrl, getSubscriptionSnapshot } from './coke-subscription.js';

export type CokeAccountAccessDeniedReason =
  | 'email_not_verified'
  | 'subscription_required'
  | 'account_suspended';

export interface CokeAccountAccessDecision {
  accountStatus: 'normal' | 'suspended';
  emailVerified: boolean;
  subscriptionActive: boolean;
  subscriptionExpiresAt: string | null;
  accountAccessAllowed: boolean;
  accountAccessDeniedReason: CokeAccountAccessDeniedReason | null;
  renewalUrl: string;
}

export interface ResolveCokeAccountAccessInput {
  account: {
    id: string;
    status: 'normal' | 'suspended';
    emailVerified: boolean;
    displayName?: string | null;
  };
  now?: Date;
  renewalUrl?: string;
}

export async function resolveCokeAccountAccess(
  input: ResolveCokeAccountAccessInput,
): Promise<CokeAccountAccessDecision> {
  const snapshot = await getSubscriptionSnapshot(input.account.id, input.now ?? new Date());
  const renewalUrl = input.renewalUrl ?? buildRenewalUrl();

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

  if (!input.account.emailVerified) {
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
