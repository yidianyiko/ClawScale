import { createHash } from 'node:crypto';

export const DEFAULT_COKE_AGENT_ID = 'aff8aa23-e892-4bae-9859-2b274cc9f8ae';
export const DEFAULT_COKE_AGENT_SLUG = 'coke';
export const DEFAULT_COKE_AGENT_NAME = 'Coke';

export interface LegacyCokeAccountSeedInput {
  cokeAccountId: string;
  email: string;
  displayName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LegacyBaselineSummaryInput {
  cokeAccounts: Array<{
    cokeAccountId: string;
    email: string;
  }>;
  clawscaleUsers: Array<{
    id: string;
    cokeAccountId: string;
    tenantId: string;
  }>;
  activeCustomerChannels: Array<{
    cokeAccountId: string;
    type: string;
  }>;
  mongoAccountIds: string[];
}

export function deriveCustomerIdFromLegacyAccount(legacyAccountId: string): string {
  return legacyAccountId;
}

function normalizeLegacyIdentityEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function deriveDeterministicPlatformId(
  scope: string,
  legacyAccountId: string,
): string {
  const hex = createHash('sha256')
    .update(`${scope}:${legacyAccountId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');

  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8).join(''),
    hex.slice(8, 12).join(''),
    hex.slice(12, 16).join(''),
    hex.slice(16, 20).join(''),
    hex.slice(20, 32).join(''),
  ].join('-');
}

export function buildLegacyCustomerGraph(input: LegacyCokeAccountSeedInput) {
  const customerId = deriveCustomerIdFromLegacyAccount(input.cokeAccountId);
  const identityId = deriveDeterministicPlatformId('identity', input.cokeAccountId);
  const membershipId = deriveDeterministicPlatformId('membership', input.cokeAccountId);
  const email = normalizeLegacyIdentityEmail(input.email);
  const displayName = input.displayName?.trim() || email;

  return {
    identity: {
      id: identityId,
      email,
      displayName,
      claimStatus: 'active' as const,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    },
    customer: {
      id: customerId,
      kind: 'personal' as const,
      displayName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    },
    membership: {
      id: membershipId,
      identityId,
      customerId,
      role: 'owner' as const,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    },
  };
}

export function buildLegacyAgentBindingSeed(input: {
  customerId: string;
  agentId: string;
}) {
  return {
    customerId: input.customerId,
    agentId: input.agentId,
    provisionStatus: 'ready' as const,
    provisionAttempts: 0,
    provisionLastError: null,
  };
}

export function buildDefaultAgentSeed(input: {
  id?: string;
  endpoint: string;
  authToken: string;
}) {
  return {
    id: input.id ?? DEFAULT_COKE_AGENT_ID,
    slug: DEFAULT_COKE_AGENT_SLUG,
    name: DEFAULT_COKE_AGENT_NAME,
    endpoint: input.endpoint,
    authToken: input.authToken,
    isDefault: true,
  };
}

export function summarizeLegacyBaseline(input: LegacyBaselineSummaryInput) {
  const clawscaleAccountIds = new Set(input.clawscaleUsers.map((row) => row.cokeAccountId));
  const cokeAccountIds = new Set(input.cokeAccounts.map((row) => row.cokeAccountId));
  const normalizedEmailToAccountIds = new Map<string, string[]>();
  const activeCustomerChannelCounts = new Map<string, number>();
  const errors: string[] = [];

  for (const account of input.cokeAccounts) {
    if (!clawscaleAccountIds.has(account.cokeAccountId)) {
      errors.push(`missing_clawscale_user:${account.cokeAccountId}`);
    }

    const normalizedEmail = normalizeLegacyIdentityEmail(account.email);
    const accountIds = normalizedEmailToAccountIds.get(normalizedEmail) ?? [];
    accountIds.push(account.cokeAccountId);
    normalizedEmailToAccountIds.set(normalizedEmail, accountIds);
  }

  for (const accountId of input.mongoAccountIds) {
    if (!cokeAccountIds.has(accountId)) {
      errors.push(`orphan_mongo_account_id:${accountId}`);
    }
  }

  for (const channel of input.activeCustomerChannels) {
    const key = `${channel.cokeAccountId}:${channel.type}`;
    activeCustomerChannelCounts.set(key, (activeCustomerChannelCounts.get(key) ?? 0) + 1);
  }

  for (const [normalizedEmail, accountIds] of [...normalizedEmailToAccountIds.entries()].sort(
    ([leftEmail], [rightEmail]) => leftEmail.localeCompare(rightEmail),
  )) {
    if (accountIds.length < 2) {
      continue;
    }

    errors.push(
      `case_insensitive_email_collision:${normalizedEmail}:accounts=${[...accountIds]
        .sort((left, right) => left.localeCompare(right))
        .join(',')}`,
    );
  }

  for (const [key, count] of [...activeCustomerChannelCounts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (count < 2) {
      continue;
    }

    const [cokeAccountId, type] = key.split(':', 2);
    errors.push(
      `duplicate_active_customer_channel:${cokeAccountId}:${type}:count=${count}`,
    );
  }

  return {
    counts: {
      cokeAccounts: input.cokeAccounts.length,
      clawscaleUsers: input.clawscaleUsers.length,
      mongoAccountIds: input.mongoAccountIds.length,
    },
    errors,
  };
}
