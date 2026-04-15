import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const tx = {
    identity: {
      upsert: vi.fn(),
    },
    customer: {
      upsert: vi.fn(),
    },
    membership: {
      upsert: vi.fn(),
    },
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
      count: vi.fn(),
    },
    clawscaleUser: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    identity: {
      count: vi.fn(),
    },
    customer: {
      count: vi.fn(),
    },
    membership: {
      count: vi.fn(),
    },
    agentBinding: {
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
  buildLegacyCustomerGraph,
  deriveDeterministicPlatformId,
} from './platformization-migration.js';

describe('platformization backfill orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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

  it('auditLegacyBaseline summarizes legacy CokeAccount and ClawscaleUser rows', async () => {
    db.client.cokeAccount.findMany.mockResolvedValue([
      { id: 'acct_1', email: 'one@example.com' },
      { id: 'acct_2', email: 'two@example.com' },
    ]);
    db.client.clawscaleUser.findMany.mockResolvedValue([
      { cokeAccountId: 'acct_1', tenantId: 'tenant_1' },
    ]);

    await expect(
      auditLegacyBaseline({
        mongoAccountIds: ['acct_1', 'acct_2', 'acct_orphan'],
      }),
    ).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        clawscaleUsers: 1,
        mongoAccountIds: 3,
      },
      errors: [
        'missing_clawscale_user:acct_2',
        'orphan_mongo_account_id:acct_orphan',
      ],
    });

    expect(db.client.cokeAccount.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['acct_1', 'acct_2', 'acct_orphan'],
        },
      },
      select: {
        id: true,
        email: true,
      },
      orderBy: { id: 'asc' },
    });
    expect(db.client.clawscaleUser.findMany).toHaveBeenCalledWith({
      where: {
        cokeAccountId: {
          in: ['acct_1', 'acct_2', 'acct_orphan'],
        },
      },
      select: {
        cokeAccountId: true,
        tenantId: true,
      },
      orderBy: { cokeAccountId: 'asc' },
    });
  });

  it('auditLegacyBaseline reports case-insensitive email collisions as blockers', async () => {
    db.client.cokeAccount.findMany.mockResolvedValue([
      { id: 'acct_1', email: 'Alice@Example.com' },
      { id: 'acct_2', email: 'alice@example.com' },
    ]);
    db.client.clawscaleUser.findMany.mockResolvedValue([
      { cokeAccountId: 'acct_1', tenantId: 'tenant_1' },
      { cokeAccountId: 'acct_2', tenantId: 'tenant_2' },
    ]);

    await expect(
      auditLegacyBaseline({
        mongoAccountIds: ['acct_1', 'acct_2'],
      }),
    ).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        clawscaleUsers: 2,
        mongoAccountIds: 2,
      },
      errors: [
        'case_insensitive_email_collision:alice@example.com:accounts=acct_1,acct_2',
      ],
    });
  });

  it('backfillLegacyCustomers upserts the new graph for each legacy CokeAccount', async () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    const updatedAt = new Date('2026-04-02T00:00:00.000Z');
    db.client.cokeAccount.findMany.mockResolvedValue([
      {
        id: 'acct_1',
        email: 'Alice@Example.com',
        displayName: 'Alice',
        passwordHash: 'hash_1',
        createdAt,
        updatedAt,
      },
      {
        id: 'acct_2',
        email: 'Bob@Example.com',
        displayName: 'Bob',
        passwordHash: 'hash_2',
        createdAt,
        updatedAt,
      },
    ]);

    await expect(
      backfillLegacyCustomers({
        agentId: 'agent_default_1',
        dryRun: false,
      }),
    ).resolves.toEqual({
      backfilled: 2,
    });

    const firstGraph = buildLegacyCustomerGraph({
      cokeAccountId: 'acct_1',
      email: 'Alice@Example.com',
      displayName: 'Alice',
      createdAt,
      updatedAt,
    });

    expect(db.client.$transaction).toHaveBeenCalledOnce();
    expect(db.tx.identity.upsert).toHaveBeenCalledTimes(2);
    expect(db.tx.customer.upsert).toHaveBeenCalledTimes(2);
    expect(db.tx.membership.upsert).toHaveBeenCalledTimes(2);
    expect(db.tx.agentBinding.upsert).toHaveBeenCalledTimes(2);

    expect(db.tx.identity.upsert).toHaveBeenNthCalledWith(1, {
      where: { id: firstGraph.identity.id },
      create: {
        ...firstGraph.identity,
        passwordHash: 'hash_1',
      },
      update: {
        email: firstGraph.identity.email,
        displayName: firstGraph.identity.displayName,
        passwordHash: 'hash_1',
        claimStatus: firstGraph.identity.claimStatus,
        updatedAt,
      },
    });
    expect(db.tx.customer.upsert).toHaveBeenNthCalledWith(1, {
      where: { id: firstGraph.customer.id },
      create: firstGraph.customer,
      update: {
        kind: firstGraph.customer.kind,
        displayName: firstGraph.customer.displayName,
        updatedAt,
      },
    });
    expect(db.tx.membership.upsert).toHaveBeenNthCalledWith(1, {
      where: { id: firstGraph.membership.id },
      create: firstGraph.membership,
      update: {
        identityId: firstGraph.membership.identityId,
        customerId: firstGraph.membership.customerId,
        role: firstGraph.membership.role,
        updatedAt,
      },
    });
    expect(db.tx.agentBinding.upsert).toHaveBeenNthCalledWith(1, {
      where: { customerId: firstGraph.customer.id },
      create: buildLegacyAgentBindingSeed({
        customerId: firstGraph.customer.id,
        agentId: 'agent_default_1',
      }),
      update: {},
    });
  });

  it('backfillLegacyCustomers dry run returns the pending count without mutating', async () => {
    db.client.cokeAccount.findMany.mockResolvedValue([
      {
        id: 'acct_1',
        email: 'one@example.com',
        displayName: 'One',
        passwordHash: 'hash_1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
      {
        id: 'acct_2',
        email: 'two@example.com',
        displayName: 'Two',
        passwordHash: 'hash_2',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    ]);

    await expect(
      backfillLegacyCustomers({
        agentId: 'agent_unused_for_dry_run',
        dryRun: true,
      }),
    ).resolves.toEqual({
      wouldBackfill: 2,
    });

    expect(db.client.$transaction).not.toHaveBeenCalled();
    expect(db.tx.identity.upsert).not.toHaveBeenCalled();
    expect(db.tx.customer.upsert).not.toHaveBeenCalled();
    expect(db.tx.membership.upsert).not.toHaveBeenCalled();
    expect(db.tx.agentBinding.upsert).not.toHaveBeenCalled();
  });

  it('verifyPlatformizationMigration reports matching counts for only the migrated legacy slice', async () => {
    const legacyAccountIds = ['acct_1', 'acct_2'];
    const membershipIds = legacyAccountIds.map((accountId) =>
      deriveDeterministicPlatformId('membership', accountId),
    );

    db.client.cokeAccount.findMany.mockResolvedValue(legacyAccountIds.map((id) => ({ id })));
    db.client.identity.count.mockResolvedValue(2);
    db.client.customer.count.mockResolvedValue(2);
    db.client.membership.count.mockResolvedValue(2);
    db.client.agentBinding.count.mockResolvedValue(2);
    db.client.agent.count.mockResolvedValue(1);
    db.client.channel.findMany.mockResolvedValue([
      {
        id: 'chan_customer_1',
        ownershipKind: 'customer',
        customerId: 'acct_1',
        agentId: null,
      },
      {
        id: 'chan_customer_2',
        ownershipKind: 'customer',
        customerId: 'acct_2',
        agentId: null,
      },
      {
        id: 'chan_shared_1',
        ownershipKind: 'shared',
        customerId: null,
        agentId: DEFAULT_COKE_AGENT_ID,
      },
    ]);

    await expect(verifyPlatformizationMigration()).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        identities: 2,
        customers: 2,
        memberships: 2,
        agentBindings: 2,
        defaultAgents: 1,
        channels: 3,
        customerOwnedChannels: 2,
        sharedOwnedChannels: 1,
        invalidOwnershipChannels: 0,
      },
      errors: [],
    });

    expect(db.client.cokeAccount.findMany).toHaveBeenCalledWith({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(db.client.customer.count).toHaveBeenCalledWith({
      where: {
        id: {
          in: legacyAccountIds,
        },
      },
    });
    expect(db.client.membership.count).toHaveBeenCalledWith({
      where: {
        id: {
          in: membershipIds,
        },
      },
    });
    expect(db.client.agentBinding.count).toHaveBeenCalledWith({
      where: {
        customerId: {
          in: legacyAccountIds,
        },
      },
    });
    expect(db.client.channel.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        ownershipKind: true,
        customerId: true,
        agentId: true,
      },
      orderBy: { id: 'asc' },
    });
  });

  it('verifyPlatformizationMigration surfaces invalid channel ownership rows and shared rows bound to the wrong agent', async () => {
    db.client.cokeAccount.findMany.mockResolvedValue([{ id: 'acct_1' }]);
    db.client.identity.count.mockResolvedValue(1);
    db.client.customer.count.mockResolvedValue(1);
    db.client.membership.count.mockResolvedValue(1);
    db.client.agentBinding.count.mockResolvedValue(1);
    db.client.agent.count.mockResolvedValue(1);
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
        customerId: 'acct_1',
        agentId: 'agent_other',
      },
    ]);

    await expect(verifyPlatformizationMigration()).resolves.toEqual({
      counts: {
        cokeAccounts: 1,
        identities: 1,
        customers: 1,
        memberships: 1,
        agentBindings: 1,
        defaultAgents: 1,
        channels: 3,
        customerOwnedChannels: 2,
        sharedOwnedChannels: 1,
        invalidOwnershipChannels: 2,
      },
      errors: [
        'invalid_channel_ownership:chan_broken_customer:ownershipKind=customer:customerId=null:agentId=null',
        `shared_channel_default_agent_mismatch:chan_wrong_shared_agent:expected=${DEFAULT_COKE_AGENT_ID}:actual=agent_other`,
        'invalid_channel_ownership:chan_customer_with_agent:ownershipKind=customer:customerId=acct_1:agentId=agent_other',
      ],
    });
  });

  it('backfill dry-run CLI skips env validation and default agent creation', async () => {
    vi.resetModules();
    vi.stubEnv('COKE_AGENT_ENDPOINT', '');
    vi.stubEnv('COKE_AGENT_AUTH_TOKEN', '');

    const ensureDefaultAgentMock = vi.fn();
    const backfillLegacyCustomersMock = vi.fn().mockResolvedValue({ wouldBackfill: 2 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const originalArgv = process.argv;

    process.argv = ['node', 'script', '--dry-run'];

    vi.doMock('../lib/platformization-backfill.js', () => ({
      ensureDefaultAgent: ensureDefaultAgentMock,
      backfillLegacyCustomers: backfillLegacyCustomersMock,
    }));

    await import('../scripts/backfill-platformization-identity.ts');

    expect(ensureDefaultAgentMock).not.toHaveBeenCalled();
    expect(backfillLegacyCustomersMock).toHaveBeenCalledWith({
      agentId: 'dry-run',
      dryRun: true,
    });

    logSpy.mockRestore();
    process.argv = originalArgv;
    vi.doUnmock('../lib/platformization-backfill.js');
  });

  it('backfill CLI refuses to write when the legacy audit reports blockers', async () => {
    vi.resetModules();
    vi.stubEnv('COKE_AGENT_ENDPOINT', 'https://coke.example.com/agent');
    vi.stubEnv('COKE_AGENT_AUTH_TOKEN', 'secret-token');

    const auditLegacyBaselineMock = vi.fn().mockResolvedValue({
      counts: {
        cokeAccounts: 2,
        clawscaleUsers: 2,
        mongoAccountIds: 0,
      },
      errors: ['case_insensitive_email_collision:alice@example.com:accounts=acct_1,acct_2'],
    });
    const ensureDefaultAgentMock = vi.fn();
    const backfillLegacyCustomersMock = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const originalArgv = process.argv;

    process.argv = ['node', 'script'];

    vi.doMock('../lib/platformization-backfill.js', () => ({
      auditLegacyBaseline: auditLegacyBaselineMock,
      ensureDefaultAgent: ensureDefaultAgentMock,
      backfillLegacyCustomers: backfillLegacyCustomersMock,
    }));

    await expect(import('../scripts/backfill-platformization-identity.ts')).rejects.toThrow(
      'platformization_audit_blocked',
    );

    expect(auditLegacyBaselineMock).toHaveBeenCalledWith({ mongoAccountIds: [] });
    expect(ensureDefaultAgentMock).not.toHaveBeenCalled();
    expect(backfillLegacyCustomersMock).not.toHaveBeenCalled();

    logSpy.mockRestore();
    process.argv = originalArgv;
    vi.doUnmock('../lib/platformization-backfill.js');
  });
});
