import { db } from '../db/index.js';
import {
  DEFAULT_COKE_AGENT_ID,
  DEFAULT_COKE_AGENT_NAME,
  DEFAULT_COKE_AGENT_SLUG,
  buildDefaultAgentSeed,
  buildLegacyAgentBindingSeed,
  buildLegacyCustomerGraph,
  deriveDeterministicPlatformId,
  summarizeLegacyBaseline,
} from './platformization-migration.js';

export interface EnsureDefaultAgentInput {
  endpoint: string;
  authToken: string;
}

export interface AuditLegacyBaselineInput {
  mongoAccountIds: string[];
}

export interface BackfillLegacyCustomersInput {
  agentId: string;
  dryRun: boolean;
}

function buildLegacyAccountWhere(ids?: string[]) {
  if (!ids || ids.length === 0) {
    return undefined;
  }

  return {
    id: {
      in: ids,
    },
  };
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
  const where = buildLegacyAccountWhere(input.mongoAccountIds);
  const [cokeAccounts, clawscaleUsers] = await Promise.all([
    db.cokeAccount.findMany({
      where,
      select: {
        id: true,
        email: true,
      },
      orderBy: { id: 'asc' },
    }),
    db.clawscaleUser.findMany({
      where: input.mongoAccountIds.length
        ? {
            cokeAccountId: {
              in: input.mongoAccountIds,
            },
          }
        : undefined,
      select: {
        cokeAccountId: true,
        tenantId: true,
      },
      orderBy: { cokeAccountId: 'asc' },
    }),
  ]);

  return summarizeLegacyBaseline({
    cokeAccounts: cokeAccounts.map((account) => ({
      cokeAccountId: account.id,
      email: account.email,
    })),
    clawscaleUsers,
    mongoAccountIds: input.mongoAccountIds,
  });
}

export async function backfillLegacyCustomers(input: BackfillLegacyCustomersInput) {
  const legacyAccounts = await db.cokeAccount.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { id: 'asc' },
  });

  if (input.dryRun) {
    return {
      wouldBackfill: legacyAccounts.length,
    };
  }

  for (const legacyAccount of legacyAccounts) {
    await db.$transaction(async (tx) => {
      const graph = buildLegacyCustomerGraph({
        cokeAccountId: legacyAccount.id,
        email: legacyAccount.email,
        displayName: legacyAccount.displayName,
        createdAt: legacyAccount.createdAt,
        updatedAt: legacyAccount.updatedAt,
      });

      await tx.identity.upsert({
        where: { id: graph.identity.id },
        create: {
          ...graph.identity,
          passwordHash: legacyAccount.passwordHash,
        },
        update: {
          email: graph.identity.email,
          displayName: graph.identity.displayName,
          passwordHash: legacyAccount.passwordHash,
          claimStatus: graph.identity.claimStatus,
          updatedAt: legacyAccount.updatedAt,
        },
      });

      await tx.customer.upsert({
        where: { id: graph.customer.id },
        create: graph.customer,
        update: {
          kind: graph.customer.kind,
          displayName: graph.customer.displayName,
          updatedAt: legacyAccount.updatedAt,
        },
      });

      await tx.membership.upsert({
        where: { id: graph.membership.id },
        create: graph.membership,
        update: {
          identityId: graph.membership.identityId,
          customerId: graph.membership.customerId,
          role: graph.membership.role,
          updatedAt: legacyAccount.updatedAt,
        },
      });

      const agentBindingSeed = buildLegacyAgentBindingSeed({
        customerId: graph.customer.id,
        agentId: input.agentId,
      });

      await tx.agentBinding.upsert({
        where: { customerId: graph.customer.id },
        create: agentBindingSeed,
        update: {},
      });
    });
  }

  return {
    backfilled: legacyAccounts.length,
  };
}

export async function verifyPlatformizationMigration() {
  const legacyAccountIds = (
    await db.cokeAccount.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
    })
  ).map((account) => account.id);
  const derivedIdentityIds = legacyAccountIds.map((accountId) =>
    deriveDeterministicPlatformId('identity', accountId),
  );
  const derivedMembershipIds = legacyAccountIds.map((accountId) =>
    deriveDeterministicPlatformId('membership', accountId),
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
    identities: await db.identity.count({
      where: {
        id: {
          in: derivedIdentityIds,
        },
      },
    }),
    customers: await db.customer.count({
      where: {
        id: {
          in: legacyAccountIds,
        },
      },
    }),
    memberships: await db.membership.count({
      where: {
        id: {
          in: derivedMembershipIds,
        },
      },
    }),
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
    if (agentBinding.agentId !== DEFAULT_COKE_AGENT_ID) {
      errors.push(
        `agent_binding_default_agent_mismatch:${agentBinding.customerId}:expected=${DEFAULT_COKE_AGENT_ID}:actual=${agentBinding.agentId}`,
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

    if (channel.ownershipKind === 'shared' && channel.agentId !== DEFAULT_COKE_AGENT_ID) {
      errors.push(
        `shared_channel_default_agent_mismatch:${channel.id}:expected=${DEFAULT_COKE_AGENT_ID}:actual=${channel.agentId}`,
      );
    }
  }

  return {
    counts,
    errors,
  };
}
