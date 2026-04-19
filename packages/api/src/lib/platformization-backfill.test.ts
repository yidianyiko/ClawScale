import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const tx = {
    agentBinding: {
      upsert: vi.fn(),
    },
  };

  const client = {
    agent: {
      upsert: vi.fn(),
      count: vi.fn(),
    },
    channel: {
      findMany: vi.fn(),
    },
    cokeAccount: {
      findMany: vi.fn(),
    },
    clawscaleUser: {
      findMany: vi.fn(),
    },
    membership: {
      findMany: vi.fn(),
    },
    customer: {
      count: vi.fn(),
    },
    identity: {
      count: vi.fn(),
    },
    agentBinding: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
  } as const;

  return { client, tx };
});

vi.mock('../db/index.js', () => ({ db: db.client }));

import {
  auditLegacyBaseline,
  backfillLegacyCustomers,
  ensureDefaultAgent,
  verifyPlatformizationMigration,
} from './platformization-backfill.js';
import {
  DEFAULT_COKE_AGENT_ID,
  buildDefaultAgentSeed,
  buildLegacyAgentBindingSeed,
} from './platformization-migration.js';

const ownerMemberships = [
  {
    customerId: 'ck_1',
    role: 'owner',
    customer: {
      id: 'ck_1',
      displayName: 'Alice',
    },
    identity: {
      id: 'idt_1',
      email: 'Alice@Example.com',
      passwordHash: 'hash_1',
      claimStatus: 'active',
    },
  },
  {
    customerId: 'ck_2',
    role: 'owner',
    customer: {
      id: 'ck_2',
      displayName: 'Bob',
    },
    identity: {
      id: 'idt_2',
      email: 'Bob@Example.com',
      passwordHash: 'hash_2',
      claimStatus: 'active',
    },
  },
] as const;

describe('platformization backfill orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    db.client.membership.findMany.mockResolvedValue(ownerMemberships);
    db.client.clawscaleUser.findMany.mockResolvedValue([
      { id: 'csu_1', cokeAccountId: 'ck_1', tenantId: 'tenant_1' },
      { id: 'csu_2', cokeAccountId: 'ck_2', tenantId: 'tenant_2' },
    ]);
    db.client.channel.findMany.mockResolvedValue([]);
    db.client.agentBinding.findMany.mockResolvedValue([]);
    db.client.agentBinding.count.mockResolvedValue(0);
    db.client.agent.count.mockResolvedValue(1);
    db.client.customer.count.mockResolvedValue(2);
    db.client.identity.count.mockResolvedValue(2);
    db.client.cokeAccount.findMany.mockResolvedValue([]);
  });

  it('ensureDefaultAgent upserts the deterministic default Coke agent and refreshes its config', async () => {
    db.client.agent.upsert.mockResolvedValue({ id: DEFAULT_COKE_AGENT_ID });

    await expect(
      ensureDefaultAgent({
        endpoint: 'https://coke.example.com/agent',
        authToken: 'secret-token',
      }),
    ).resolves.toBe(DEFAULT_COKE_AGENT_ID);

    expect(db.client.agent.upsert).toHaveBeenCalledWith({
      where: { id: DEFAULT_COKE_AGENT_ID },
      create: expect.objectContaining({
        ...buildDefaultAgentSeed({
          endpoint: 'https://coke.example.com/agent',
          authToken: 'secret-token',
        }),
      }),
      update: {
        slug: 'coke',
        name: 'Coke',
        endpoint: 'https://coke.example.com/agent',
        authToken: 'secret-token',
        isDefault: true,
      },
    });
  });

  it('auditLegacyBaseline summarizes customer-backed owner memberships and clawscale users', async () => {
    db.client.membership.findMany.mockResolvedValue(ownerMemberships.slice(0, 2));
    db.client.clawscaleUser.findMany.mockResolvedValue([
      { id: 'csu_1', cokeAccountId: 'ck_1', tenantId: 'tenant_1' },
    ]);

    await expect(
      auditLegacyBaseline({
        mongoAccountIds: ['ck_1', 'ck_2', 'ck_orphan'],
      }),
    ).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        clawscaleUsers: 1,
        mongoAccountIds: 3,
      },
      errors: ['missing_clawscale_user:ck_2', 'orphan_mongo_account_id:ck_orphan'],
    });

    expect(db.client.membership.findMany).toHaveBeenCalledWith({
      where: {
        customerId: {
          in: ['ck_1', 'ck_2', 'ck_orphan'],
        },
        role: 'owner',
      },
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
    expect(db.client.clawscaleUser.findMany).toHaveBeenCalledWith({
      where: {
        cokeAccountId: {
          in: ['ck_1', 'ck_2', 'ck_orphan'],
        },
      },
      select: {
        id: true,
        cokeAccountId: true,
        tenantId: true,
      },
      orderBy: { cokeAccountId: 'asc' },
    });
  });

  it('auditLegacyBaseline reports case-insensitive email collisions and duplicate active channels as blockers', async () => {
    db.client.membership.findMany.mockResolvedValue([
      ownerMemberships[0],
      {
        ...ownerMemberships[1],
        identity: {
          ...ownerMemberships[1].identity,
          email: 'alice@example.com',
        },
      },
    ]);
    db.client.channel.findMany.mockResolvedValue([
      { ownerClawscaleUserId: 'csu_1', type: 'wechat_personal' },
      { ownerClawscaleUserId: 'csu_1', type: 'wechat_personal' },
    ]);

    await expect(
      auditLegacyBaseline({
        mongoAccountIds: ['ck_1', 'ck_2'],
      }),
    ).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        clawscaleUsers: 2,
        mongoAccountIds: 2,
      },
      errors: [
        'case_insensitive_email_collision:alice@example.com:accounts=ck_1,ck_2',
        'duplicate_active_customer_channel:ck_1:wechat_personal:count=2',
      ],
    });
  });

  it('backfillLegacyCustomers upserts ready agent bindings from customer-backed owner memberships', async () => {
    await expect(
      backfillLegacyCustomers({
        agentId: 'agent_default_1',
        dryRun: false,
        cokeAccountIds: ['ck_1', 'ck_2'],
      }),
    ).resolves.toEqual({
      backfilled: 2,
    });

    expect(db.client.membership.findMany).toHaveBeenCalledWith({
      where: {
        customerId: {
          in: ['ck_1', 'ck_2'],
        },
        role: 'owner',
      },
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
    expect(db.client.$transaction).toHaveBeenCalledTimes(2);
    expect(db.tx.agentBinding.upsert).toHaveBeenNthCalledWith(1, {
      where: { customerId: 'ck_1' },
      create: buildLegacyAgentBindingSeed({
        customerId: 'ck_1',
        agentId: 'agent_default_1',
      }),
      update: {
        agentId: 'agent_default_1',
        provisionStatus: 'ready',
        provisionAttempts: 0,
        provisionLastError: null,
      },
    });
  });

  it('backfillLegacyCustomers dry run returns the pending count without mutating', async () => {
    await expect(
      backfillLegacyCustomers({
        agentId: 'agent_unused_for_dry_run',
        dryRun: true,
        cokeAccountIds: ['ck_1', 'ck_2'],
      }),
    ).resolves.toEqual({
      wouldBackfill: 2,
    });

    expect(db.client.$transaction).not.toHaveBeenCalled();
    expect(db.tx.agentBinding.upsert).not.toHaveBeenCalled();
  });

  it('verifyPlatformizationMigration reports matching counts for a requested migrated customer-backed slice', async () => {
    db.client.membership.findMany.mockResolvedValue(ownerMemberships);
    db.client.agentBinding.findMany.mockResolvedValue([
      {
        customerId: 'ck_1',
        agentId: DEFAULT_COKE_AGENT_ID,
        provisionStatus: 'ready',
      },
      {
        customerId: 'ck_2',
        agentId: DEFAULT_COKE_AGENT_ID,
        provisionStatus: 'ready',
      },
    ]);
    db.client.agentBinding.count.mockResolvedValue(2);
    db.client.channel.findMany.mockResolvedValue([
      {
        id: 'chan_customer_1',
        ownershipKind: 'customer',
        customerId: 'ck_1',
        agentId: null,
      },
      {
        id: 'chan_customer_2',
        ownershipKind: 'customer',
        customerId: 'ck_2',
        agentId: null,
      },
      {
        id: 'chan_shared_1',
        ownershipKind: 'shared',
        customerId: null,
        agentId: DEFAULT_COKE_AGENT_ID,
      },
    ]);

    await expect(
      verifyPlatformizationMigration({
        cokeAccountIds: ['ck_1', 'ck_2'],
        expectedAgentId: DEFAULT_COKE_AGENT_ID,
      }),
    ).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        identities: 2,
        customers: 2,
        memberships: 2,
        agentBindings: 2,
        defaultAgents: 1,
        channels: 3,
        verifiedAgentBindings: 2,
        customerOwnedChannels: 2,
        sharedOwnedChannels: 1,
        invalidOwnershipChannels: 0,
      },
      errors: [],
    });
  });

  it('verifyPlatformizationMigration reports missing requested owner memberships as blockers', async () => {
    db.client.membership.findMany.mockResolvedValue([ownerMemberships[0]]);
    db.client.agentBinding.findMany.mockResolvedValue([
      {
        customerId: 'ck_1',
        agentId: DEFAULT_COKE_AGENT_ID,
        provisionStatus: 'ready',
      },
    ]);
    db.client.agentBinding.count.mockResolvedValue(1);
    db.client.channel.findMany.mockResolvedValue([]);

    await expect(
      verifyPlatformizationMigration({
        cokeAccountIds: ['ck_1', 'ck_missing'],
        expectedAgentId: DEFAULT_COKE_AGENT_ID,
      }),
    ).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        identities: 1,
        customers: 1,
        memberships: 1,
        agentBindings: 1,
        defaultAgents: 1,
        channels: 0,
        verifiedAgentBindings: 1,
        customerOwnedChannels: 0,
        sharedOwnedChannels: 0,
        invalidOwnershipChannels: 0,
      },
      errors: [
        'missing_owner_membership:ck_missing',
        'identity_count_mismatch:expected=2:actual=1',
        'customer_count_mismatch:expected=2:actual=1',
        'membership_count_mismatch:expected=2:actual=1',
        'agent_binding_count_mismatch:expected=2:actual=1',
      ],
    });
  });

  it('verifyPlatformizationMigration surfaces invalid channel ownership rows and non-ready agent bindings', async () => {
    db.client.membership.findMany.mockResolvedValue([ownerMemberships[0]]);
    db.client.customer.count.mockResolvedValue(1);
    db.client.identity.count.mockResolvedValue(1);
    db.client.agentBinding.count.mockResolvedValue(1);
    db.client.agentBinding.findMany.mockResolvedValue([
      {
        customerId: 'ck_1',
        agentId: 'agent_other',
        provisionStatus: 'error',
      },
    ]);
    db.client.channel.findMany.mockResolvedValue([
      {
        id: 'chan_broken_customer',
        ownershipKind: 'customer',
        customerId: null,
        agentId: null,
      },
      {
        id: 'chan_wrong_shared_agent',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_other',
      },
      {
        id: 'chan_customer_with_agent',
        ownershipKind: 'customer',
        customerId: 'ck_1',
        agentId: 'agent_other',
      },
    ]);

    await expect(
      verifyPlatformizationMigration({
        cokeAccountIds: ['ck_1'],
        expectedAgentId: DEFAULT_COKE_AGENT_ID,
      }),
    ).resolves.toEqual({
      counts: {
        cokeAccounts: 1,
        identities: 1,
        customers: 1,
        memberships: 1,
        agentBindings: 1,
        defaultAgents: 1,
        channels: 3,
        verifiedAgentBindings: 1,
        customerOwnedChannels: 2,
        sharedOwnedChannels: 1,
        invalidOwnershipChannels: 2,
      },
      errors: [
        `agent_binding_agent_mismatch:ck_1:expected=${DEFAULT_COKE_AGENT_ID}:actual=agent_other`,
        'agent_binding_provision_status_mismatch:ck_1:expected=ready:actual=error',
        'invalid_channel_ownership:chan_broken_customer:ownershipKind=customer:customerId=null:agentId=null',
        'invalid_channel_ownership:chan_customer_with_agent:ownershipKind=customer:customerId=ck_1:agentId=agent_other',
      ],
    });
  });
});
