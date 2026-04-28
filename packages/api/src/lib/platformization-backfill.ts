import { db } from '../db/index.js';
import {
  DEFAULT_COKE_AGENT_ID,
  DEFAULT_COKE_AGENT_NAME,
  DEFAULT_COKE_AGENT_SLUG,
  buildDefaultAgentSeed,
  buildLegacyAgentBindingSeed,
  summarizeLegacyBaseline,
} from './platformization-migration.js';

interface EnsureDefaultAgentInput {
  endpoint: string;
  authToken: string;
}

interface AuditLegacyBaselineInput {
  mongoAccountIds: string[];
}

interface BackfillLegacyCustomersInput {
  agentId: string;
  dryRun: boolean;
  cokeAccountIds?: string[];
}

interface VerifyPlatformizationMigrationInput {
  cokeAccountIds?: string[];
  expectedAgentId?: string;
}

function buildCustomerOwnerWhere(ids?: string[]) {
  return {
    ...(ids && ids.length > 0
      ? {
          customerId: {
            in: ids,
          },
        }
      : {}),
    role: 'owner' as const,
  };
}

async function listCustomerOwners(ids?: string[]) {
  return db.membership.findMany({
    where: buildCustomerOwnerWhere(ids),
    include: {
      customer: {
        select: {
          id: true,
          displayName: true,
        },
      },
      identity: {
        select: {
          id: true,
          email: true,
          passwordHash: true,
          claimStatus: true,
        },
      },
    },
    orderBy: { customerId: 'asc' },
  });
}

export async function ensureDefaultAgent(input: EnsureDefaultAgentInput) {
  const defaultAgent = await db.agent.upsert({
    where: { id: DEFAULT_COKE_AGENT_ID },
    create: buildDefaultAgentSeed(input),
    update: {
      slug: DEFAULT_COKE_AGENT_SLUG,
      name: DEFAULT_COKE_AGENT_NAME,
      endpoint: input.endpoint,
      authToken: input.authToken,
      isDefault: true,
    },
  });

  return defaultAgent.id;
}

export async function auditLegacyBaseline(input: AuditLegacyBaselineInput) {
  const [customerOwners, clawscaleUsers] = await Promise.all([
    listCustomerOwners(input.mongoAccountIds),
    db.clawscaleUser.findMany({
      where: input.mongoAccountIds.length
        ? {
            cokeAccountId: {
              in: input.mongoAccountIds,
            },
          }
        : undefined,
      select: {
        id: true,
        cokeAccountId: true,
        tenantId: true,
      },
      orderBy: { cokeAccountId: 'asc' },
    }),
  ]);

  const ownerClawscaleUserIds = clawscaleUsers.map((row) => row.id);
  const activeCustomerChannels = ownerClawscaleUserIds.length
    ? await db.channel.findMany({
        where: {
          ownerClawscaleUserId: {
            in: ownerClawscaleUserIds,
          },
          status: {
            not: 'archived',
          },
        },
        select: {
          ownerClawscaleUserId: true,
          type: true,
        },
        orderBy: [{ ownerClawscaleUserId: 'asc' }, { type: 'asc' }, { id: 'asc' }],
      })
    : [];
  const ownerToCokeAccountId = new Map(
    clawscaleUsers.map((row) => [row.id, row.cokeAccountId] as const),
  );

  return summarizeLegacyBaseline({
    cokeAccounts: customerOwners.flatMap((membership) => {
      if (!membership.identity.email) {
        return [];
      }

      return [
        {
          cokeAccountId: membership.customer.id,
          email: membership.identity.email,
        },
      ];
    }),
    clawscaleUsers,
    activeCustomerChannels: activeCustomerChannels.flatMap((channel) => {
      if (!channel.ownerClawscaleUserId) {
        return [];
      }

      const cokeAccountId = ownerToCokeAccountId.get(channel.ownerClawscaleUserId);
      if (!cokeAccountId) {
        return [];
      }

      return [
        {
          cokeAccountId,
          type: channel.type,
        },
      ];
    }),
    mongoAccountIds: input.mongoAccountIds,
  });
}

export async function backfillLegacyCustomers(input: BackfillLegacyCustomersInput) {
  const customerOwners = await listCustomerOwners(input.cokeAccountIds);

  if (input.dryRun) {
    return {
      wouldBackfill: customerOwners.length,
    };
  }

  for (const customerOwner of customerOwners) {
    await db.$transaction(async (tx) => {
      const agentBindingSeed = buildLegacyAgentBindingSeed({
        customerId: customerOwner.customer.id,
        agentId: input.agentId,
      });

      await tx.agentBinding.upsert({
        where: { customerId: customerOwner.customer.id },
        create: agentBindingSeed,
        update: {
          agentId: agentBindingSeed.agentId,
          provisionStatus: agentBindingSeed.provisionStatus,
          provisionAttempts: agentBindingSeed.provisionAttempts,
          provisionLastError: agentBindingSeed.provisionLastError,
        },
      });
    });
  }

  return {
    backfilled: customerOwners.length,
  };
}

export async function verifyPlatformizationMigration(
  input: VerifyPlatformizationMigrationInput = {},
) {
  const customerOwners = await listCustomerOwners(input.cokeAccountIds);
  const requestedAccountIds = input.cokeAccountIds ?? [];
  const legacyAccountIds =
    requestedAccountIds.length > 0
      ? requestedAccountIds
      : customerOwners.map((membership) => membership.customer.id);
  const loadedAccountIds = new Set(
    customerOwners.map((membership) => membership.customer.id),
  );

  const channels = await db.channel.findMany({
    select: {
      id: true,
      ownershipKind: true,
      customerId: true,
      agentId: true,
    },
    orderBy: { id: 'asc' },
  });
  const agentBindings = await db.agentBinding.findMany({
    where: {
      customerId: {
        in: legacyAccountIds,
      },
    },
    select: {
      customerId: true,
      agentId: true,
      provisionStatus: true,
    },
    orderBy: { customerId: 'asc' },
  });

  const counts = {
    cokeAccounts: legacyAccountIds.length,
    identities: customerOwners.length,
    customers: customerOwners.length,
    memberships: customerOwners.length,
    agentBindings: await db.agentBinding.count({
      where: {
        customerId: {
          in: legacyAccountIds,
        },
      },
    }),
    defaultAgents: await db.agent.count({
      where: { isDefault: true },
    }),
    channels: channels.length,
    verifiedAgentBindings: agentBindings.length,
    customerOwnedChannels: channels.filter((channel) => channel.ownershipKind === 'customer').length,
    sharedOwnedChannels: channels.filter((channel) => channel.ownershipKind === 'shared').length,
    invalidOwnershipChannels: 0,
  };

  const errors: string[] = [];

  for (const accountId of legacyAccountIds) {
    if (!loadedAccountIds.has(accountId)) {
      errors.push(`missing_owner_membership:${accountId}`);
    }
  }

  if (counts.identities !== counts.cokeAccounts) {
    errors.push(
      `identity_count_mismatch:expected=${counts.cokeAccounts}:actual=${counts.identities}`,
    );
  }
  if (counts.customers !== counts.cokeAccounts) {
    errors.push(
      `customer_count_mismatch:expected=${counts.cokeAccounts}:actual=${counts.customers}`,
    );
  }
  if (counts.memberships !== counts.cokeAccounts) {
    errors.push(
      `membership_count_mismatch:expected=${counts.cokeAccounts}:actual=${counts.memberships}`,
    );
  }
  if (counts.agentBindings !== counts.cokeAccounts) {
    errors.push(
      `agent_binding_count_mismatch:expected=${counts.cokeAccounts}:actual=${counts.agentBindings}`,
    );
  }
  if (counts.defaultAgents !== 1) {
    errors.push(`default_agent_count_mismatch:expected=1:actual=${counts.defaultAgents}`);
  }

  for (const agentBinding of agentBindings) {
    if (input.expectedAgentId && agentBinding.agentId !== input.expectedAgentId) {
      errors.push(
        `agent_binding_agent_mismatch:${agentBinding.customerId}:expected=${input.expectedAgentId}:actual=${agentBinding.agentId}`,
      );
    }
    if (agentBinding.provisionStatus !== 'ready') {
      errors.push(
        `agent_binding_provision_status_mismatch:${agentBinding.customerId}:expected=ready:actual=${agentBinding.provisionStatus}`,
      );
    }
  }

  for (const channel of channels) {
    const isCustomerOwned =
      channel.ownershipKind === 'customer' &&
      channel.customerId !== null &&
      channel.agentId === null;
    const isSharedOwned =
      channel.ownershipKind === 'shared' &&
      channel.customerId === null &&
      channel.agentId !== null;

    if (!isCustomerOwned && !isSharedOwned) {
      counts.invalidOwnershipChannels += 1;
      errors.push(
        `invalid_channel_ownership:${channel.id}:ownershipKind=${channel.ownershipKind}:customerId=${channel.customerId ?? 'null'}:agentId=${channel.agentId ?? 'null'}`,
      );
      continue;
    }
  }

  return {
    counts,
    errors,
  };
}
