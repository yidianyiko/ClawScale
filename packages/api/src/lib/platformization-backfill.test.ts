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
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
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
  buildDefaultAgentSeed,
  buildLegacyAgentBindingSeed,
  buildLegacyCustomerGraph,
} from './platformization-migration.js';

describe('platformization backfill orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ensureDefaultAgent creates the default Coke agent when one does not exist', async () => {
    db.client.agent.findFirst.mockResolvedValue(null);
    db.client.agent.create.mockResolvedValue({ id: 'agent_default_1' });

    await expect(
      ensureDefaultAgent({
        endpoint: 'https://coke.example.com/agent',
        authToken: 'secret-token',
      }),
    ).resolves.toBe('agent_default_1');

    expect(db.client.agent.findFirst).toHaveBeenCalledWith({
      where: { isDefault: true },
      select: { id: true },
    });
    expect(db.client.agent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ...buildDefaultAgentSeed({
          id: expect.any(String) as unknown as string,
          endpoint: 'https://coke.example.com/agent',
          authToken: 'secret-token',
        }),
      }),
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
        createdAt,
        updatedAt,
      },
    });
    expect(db.tx.customer.upsert).toHaveBeenNthCalledWith(1, {
      where: { id: firstGraph.customer.id },
      create: firstGraph.customer,
      update: {
        kind: firstGraph.customer.kind,
        displayName: firstGraph.customer.displayName,
        createdAt,
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
        createdAt,
        updatedAt,
      },
    });
    expect(db.tx.agentBinding.upsert).toHaveBeenNthCalledWith(1, {
      where: { customerId: firstGraph.customer.id },
      create: buildLegacyAgentBindingSeed({
        customerId: firstGraph.customer.id,
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

  it('verifyPlatformizationMigration reports matching graph counts after a successful backfill', async () => {
    db.client.cokeAccount.count.mockResolvedValue(2);
    db.client.identity.count.mockResolvedValue(2);
    db.client.customer.count.mockResolvedValue(2);
    db.client.membership.count.mockResolvedValue(2);
    db.client.agentBinding.count.mockResolvedValue(2);
    db.client.agent.count.mockResolvedValue(1);

    await expect(verifyPlatformizationMigration()).resolves.toEqual({
      counts: {
        cokeAccounts: 2,
        identities: 2,
        customers: 2,
        memberships: 2,
        agentBindings: 2,
        defaultAgents: 1,
      },
      errors: [],
    });
  });
});
