import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client = {
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
      create: vi.fn(),
      upsert: vi.fn(),
    },
    tenant: {
      create: vi.fn(),
    },
    aiBackend: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    endUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    cokeAccount: {
      findUnique: vi.fn(),
    },
    clawscaleUser: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(client)),
  } as any;
  return client;
});

vi.mock('../db/index.js', () => ({ db }));

import {
  bindEndUserToCokeAccount,
  ensureClawscaleUserForCokeAccount,
  getUnifiedConversationIds,
} from './clawscale-user.js';
import {
  DEFAULT_COKE_AGENT_ID,
  buildLegacyAgentBindingSeed,
  buildLegacyCustomerGraph,
} from './platformization-migration.js';

const defaultCokeAccount = {
  id: 'acct_1',
  email: 'Alice@Example.com',
  displayName: 'Alice',
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-02T00:00:00.000Z'),
};

describe('clawscale-user helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COKE_BRIDGE_INBOUND_URL = 'http://127.0.0.1:8090/bridge/inbound';
    process.env.COKE_BRIDGE_API_KEY = 'dev-bridge-key';
    db.cokeAccount.findUnique.mockResolvedValue(defaultCokeAccount);
  });

  it('bindEndUserToCokeAccount upserts a tenant-scoped ClawscaleUser and attaches an EndUser', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'ext_1',
      clawscaleUserId: null,
    });
    db.clawscaleUser.findUnique.mockResolvedValue({ id: 'csu_1', tenantId: 'ten_1' });
    db.endUser.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      bindEndUserToCokeAccount({
        tenantId: 'ten_1',
        channelId: 'ch_1',
        externalId: 'ext_1',
        cokeAccountId: 'acct_1',
      }),
    ).resolves.toEqual({
      clawscaleUserId: 'csu_1',
      endUserId: 'eu_1',
      cokeAccountId: 'acct_1',
    });

    expect(db.clawscaleUser.findUnique).toHaveBeenCalledWith({
      where: { cokeAccountId: 'acct_1' },
      select: {
        id: true,
        tenantId: true,
      },
    });
    expect(db.endUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'eu_1',
          tenantId: 'ten_1',
          OR: [
            { clawscaleUserId: null },
            { clawscaleUserId: 'csu_1' },
          ],
        },
        data: { clawscaleUserId: 'csu_1' },
      }),
    );
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it('bindEndUserToCokeAccount rejects when the guarded update detects a concurrent bind', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'ext_1',
      clawscaleUserId: null,
    });
    db.clawscaleUser.findUnique.mockResolvedValue({ id: 'csu_new', tenantId: 'ten_1' });
    db.endUser.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      bindEndUserToCokeAccount({
        tenantId: 'ten_1',
        channelId: 'ch_1',
        externalId: 'ext_1',
        cokeAccountId: 'acct_1',
      }),
    ).rejects.toMatchObject({ code: 'end_user_already_bound' });
    expect(db.endUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'eu_1',
          tenantId: 'ten_1',
          OR: [
            { clawscaleUserId: null },
            { clawscaleUserId: 'csu_new' },
          ],
        },
      }),
    );
  });

  it('bindEndUserToCokeAccount fails when coke account has no global binding', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'ext_1',
      clawscaleUserId: null,
    });
    db.clawscaleUser.findUnique.mockResolvedValue(null);

    await expect(
      bindEndUserToCokeAccount({
        tenantId: 'ten_1',
        channelId: 'ch_1',
        externalId: 'ext_1',
        cokeAccountId: 'acct_missing',
      }),
    ).rejects.toMatchObject({ code: 'coke_account_not_found' });

    expect(db.endUser.updateMany).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount fails when the coke account is missing', async () => {
    db.cokeAccount.findUnique.mockResolvedValueOnce(null);

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_missing',
        displayName: 'Missing',
      }),
    ).rejects.toMatchObject({ code: 'coke_account_not_found' });

    expect(db.tenant.create).not.toHaveBeenCalled();
    expect(db.clawscaleUser.create).not.toHaveBeenCalled();
  });

  it('getUnifiedConversationIds returns all conversations for the same clawscaleUserId', async () => {
    db.endUser.findMany.mockResolvedValue([{ id: 'eu_1' }, { id: 'eu_2' }]);
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_1' }, { id: 'conv_2' }]);

    await expect(
      getUnifiedConversationIds({
        tenantId: 'ten_1',
        endUserId: 'eu_1',
        clawscaleUserId: 'csu_1',
        linkedTo: null,
      }),
    ).resolves.toEqual(['conv_1', 'conv_2']);
  });

  it('getUnifiedConversationIds falls back to linkedTo when no clawscaleUserId is present', async () => {
    db.endUser.findMany.mockResolvedValue([{ id: 'eu_1' }, { id: 'eu_2' }]);
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_9' }]);

    await expect(
      getUnifiedConversationIds({
        tenantId: 'ten_1',
        endUserId: 'eu_2',
        clawscaleUserId: null,
        linkedTo: 'eu_1',
      }),
    ).resolves.toEqual(['conv_9']);
  });

  it('ensureClawscaleUserForCokeAccount creates a personal tenant and user when missing', async () => {
    db.clawscaleUser.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    db.tenant.create.mockResolvedValue({ id: 'tnt_new' });
    db.clawscaleUser.create.mockResolvedValue({ id: 'csu_new', tenantId: 'tnt_new' });
    db.aiBackend.create.mockResolvedValue({ id: 'aib_bridge' });
    const graph = buildLegacyCustomerGraph({
      cokeAccountId: defaultCokeAccount.id,
      email: defaultCokeAccount.email,
      displayName: defaultCokeAccount.displayName,
      createdAt: defaultCokeAccount.createdAt,
      updatedAt: defaultCokeAccount.updatedAt,
    });

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_1',
        displayName: 'Alice',
      }),
    ).resolves.toEqual({
      tenantId: expect.any(String),
      clawscaleUserId: expect.any(String),
      created: true,
      ready: true,
    });

    expect(db.tenant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'personal-acct_1',
        name: "Alice's Workspace",
      }),
    });
    expect(db.clawscaleUser.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        tenantId: expect.any(String),
        cokeAccountId: 'acct_1',
      },
    });
    expect(db.aiBackend.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        tenantId: expect.any(String),
        name: 'Coke Bridge',
        type: 'custom',
        isActive: true,
        isDefault: true,
        config: {
          baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
          transport: 'http',
          responseFormat: 'json-auto',
          authHeader: 'Bearer dev-bridge-key',
        },
      },
    });
    expect(db.identity.upsert).toHaveBeenCalledWith({
      where: { id: graph.identity.id },
      create: {
        ...graph.identity,
        passwordHash: null,
      },
      update: {
        email: graph.identity.email,
        displayName: graph.identity.displayName,
        passwordHash: null,
        claimStatus: graph.identity.claimStatus,
        updatedAt: defaultCokeAccount.updatedAt,
      },
    });
    expect(db.customer.upsert).toHaveBeenCalledWith({
      where: { id: graph.customer.id },
      create: graph.customer,
      update: {
        kind: graph.customer.kind,
        displayName: graph.customer.displayName,
        updatedAt: defaultCokeAccount.updatedAt,
      },
    });
    expect(db.membership.upsert).toHaveBeenCalledWith({
      where: { id: graph.membership.id },
      create: graph.membership,
      update: {
        identityId: graph.membership.identityId,
        customerId: graph.membership.customerId,
        role: graph.membership.role,
        updatedAt: defaultCokeAccount.updatedAt,
      },
    });
    expect(db.agentBinding.create).toHaveBeenCalledWith({
      data: buildLegacyAgentBindingSeed({
        customerId: graph.customer.id,
        agentId: DEFAULT_COKE_AGENT_ID,
      }),
    });
    expect(db.agentBinding.upsert).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount reuses an existing mapping', async () => {
    const existingAccount = {
      id: 'acct_existing',
      email: 'Existing@Example.com',
      displayName: 'Existing User',
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    };
    const graph = buildLegacyCustomerGraph({
      cokeAccountId: existingAccount.id,
      email: existingAccount.email,
      displayName: existingAccount.displayName,
      createdAt: existingAccount.createdAt,
      updatedAt: existingAccount.updatedAt,
    });
    db.cokeAccount.findUnique.mockResolvedValueOnce(existingAccount);
    db.clawscaleUser.findUnique.mockResolvedValueOnce({
      id: 'csu_existing',
      tenantId: 'tnt_existing',
    });
    db.aiBackend.findFirst.mockResolvedValueOnce({
      id: 'aib_existing',
      tenantId: 'tnt_existing',
      type: 'custom',
      isActive: true,
      isDefault: true,
      config: {
        baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
        transport: 'http',
        responseFormat: 'json-auto',
        authHeader: 'Bearer dev-bridge-key',
      },
    });

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_existing',
      }),
    ).resolves.toEqual({
      tenantId: 'tnt_existing',
      clawscaleUserId: 'csu_existing',
      created: false,
      ready: true,
    });

    expect(db.tenant.create).not.toHaveBeenCalled();
    expect(db.clawscaleUser.create).not.toHaveBeenCalled();
    expect(db.aiBackend.create).not.toHaveBeenCalled();
    expect(db.identity.upsert).toHaveBeenCalledWith({
      where: { id: graph.identity.id },
      create: {
        ...graph.identity,
        passwordHash: null,
      },
      update: {
        email: graph.identity.email,
        displayName: graph.identity.displayName,
        passwordHash: null,
        claimStatus: graph.identity.claimStatus,
        updatedAt: existingAccount.updatedAt,
      },
    });
    expect(db.customer.upsert).toHaveBeenCalledWith({
      where: { id: graph.customer.id },
      create: graph.customer,
      update: {
        kind: graph.customer.kind,
        displayName: graph.customer.displayName,
        updatedAt: existingAccount.updatedAt,
      },
    });
    expect(db.membership.upsert).toHaveBeenCalledWith({
      where: { id: graph.membership.id },
      create: graph.membership,
      update: {
        identityId: graph.membership.identityId,
        customerId: graph.membership.customerId,
        role: graph.membership.role,
        updatedAt: existingAccount.updatedAt,
      },
    });
    expect(db.agentBinding.create).toHaveBeenCalledWith({
      data: buildLegacyAgentBindingSeed({
        customerId: graph.customer.id,
        agentId: DEFAULT_COKE_AGENT_ID,
      }),
    });
    expect(db.agentBinding.upsert).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount keeps existing mappings usable when compatibility AgentBinding write fails', async () => {
    const existingAccount = {
      id: 'acct_existing',
      email: 'Existing@Example.com',
      displayName: 'Existing User',
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    };
    const graph = buildLegacyCustomerGraph({
      cokeAccountId: existingAccount.id,
      email: existingAccount.email,
      displayName: existingAccount.displayName,
      createdAt: existingAccount.createdAt,
      updatedAt: existingAccount.updatedAt,
    });
    const compatibilityError = new Error('default agent binding is unavailable');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    db.cokeAccount.findUnique.mockResolvedValueOnce(existingAccount);
    db.clawscaleUser.findUnique.mockResolvedValueOnce({
      id: 'csu_existing',
      tenantId: 'tnt_existing',
    });
    db.agentBinding.create.mockRejectedValueOnce(compatibilityError);
    db.agentBinding.upsert.mockRejectedValueOnce(compatibilityError);
    db.aiBackend.findFirst.mockResolvedValueOnce({
      id: 'aib_existing',
      tenantId: 'tnt_existing',
      type: 'custom',
      isActive: true,
      isDefault: true,
      config: {
        baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
        transport: 'http',
        responseFormat: 'json-auto',
        authHeader: 'Bearer dev-bridge-key',
      },
    });

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_existing',
      }),
    ).resolves.toEqual({
      tenantId: 'tnt_existing',
      clawscaleUserId: 'csu_existing',
      created: false,
      ready: true,
    });

    expect(db.identity.upsert).toHaveBeenCalledWith({
      where: { id: graph.identity.id },
      create: {
        ...graph.identity,
        passwordHash: null,
      },
      update: {
        email: graph.identity.email,
        displayName: graph.identity.displayName,
        passwordHash: null,
        claimStatus: graph.identity.claimStatus,
        updatedAt: existingAccount.updatedAt,
      },
    });
    expect(db.customer.upsert).toHaveBeenCalledWith({
      where: { id: graph.customer.id },
      create: graph.customer,
      update: {
        kind: graph.customer.kind,
        displayName: graph.customer.displayName,
        updatedAt: existingAccount.updatedAt,
      },
    });
    expect(db.membership.upsert).toHaveBeenCalledWith({
      where: { id: graph.membership.id },
      create: graph.membership,
      update: {
        identityId: graph.membership.identityId,
        customerId: graph.membership.customerId,
        role: graph.membership.role,
        updatedAt: existingAccount.updatedAt,
      },
    });
    expect(db.agentBinding.create).toHaveBeenCalledWith({
      data: buildLegacyAgentBindingSeed({
        customerId: graph.customer.id,
        agentId: DEFAULT_COKE_AGENT_ID,
      }),
    });
    expect(db.agentBinding.upsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[clawscale-user] compatibility AgentBinding shadow write skipped',
      expect.objectContaining({
        cokeAccountId: existingAccount.id,
        error: compatibilityError,
      }),
    );
    warnSpy.mockRestore();
  });

  it('ensureClawscaleUserForCokeAccount keeps existing mappings usable when identity email shadow write collides', async () => {
    const existingAccount = {
      id: 'acct_existing',
      email: 'Existing@Example.com',
      displayName: 'Existing User',
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    };
    const identityCollisionError = {
      code: 'P2002',
      meta: {
        target: ['email'],
      },
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    db.cokeAccount.findUnique.mockResolvedValueOnce(existingAccount);
    db.clawscaleUser.findUnique.mockResolvedValueOnce({
      id: 'csu_existing',
      tenantId: 'tnt_existing',
    });
    db.identity.upsert.mockRejectedValueOnce(identityCollisionError);
    db.aiBackend.findFirst.mockResolvedValueOnce({
      id: 'aib_existing',
      tenantId: 'tnt_existing',
      type: 'custom',
      isActive: true,
      isDefault: true,
      config: {
        baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
        transport: 'http',
        responseFormat: 'json-auto',
        authHeader: 'Bearer dev-bridge-key',
      },
    });

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_existing',
      }),
    ).resolves.toEqual({
      tenantId: 'tnt_existing',
      clawscaleUserId: 'csu_existing',
      created: false,
      ready: true,
    });

    expect(db.customer.upsert).toHaveBeenCalledWith({
      where: { id: existingAccount.id },
      create: expect.objectContaining({
        id: existingAccount.id,
        kind: 'personal',
      }),
      update: expect.objectContaining({
        kind: 'personal',
        updatedAt: existingAccount.updatedAt,
      }),
    });
    expect(db.membership.upsert).not.toHaveBeenCalled();
    expect(db.agentBinding.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[clawscale-user] compatibility Identity shadow write skipped due to email collision',
      expect.objectContaining({
        cokeAccountId: existingAccount.id,
        email: 'existing@example.com',
        error: identityCollisionError,
      }),
    );
    warnSpy.mockRestore();
  });

  it('ensureClawscaleUserForCokeAccount recovers when cokeAccountId create races and still shadow-writes the compatibility graph', async () => {
    const racedAccount = {
      id: 'acct_race',
      email: 'Race@Example.com',
      displayName: 'Race User',
      createdAt: new Date('2026-04-05T00:00:00.000Z'),
      updatedAt: new Date('2026-04-06T00:00:00.000Z'),
    };
    const graph = buildLegacyCustomerGraph({
      cokeAccountId: racedAccount.id,
      email: racedAccount.email,
      displayName: racedAccount.displayName,
      createdAt: racedAccount.createdAt,
      updatedAt: racedAccount.updatedAt,
    });

    db.cokeAccount.findUnique.mockResolvedValue(racedAccount);
    db.clawscaleUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'csu_raced',
        tenantId: 'tnt_raced',
      });
    db.tenant.create.mockResolvedValue({ id: 'tnt_new' });
    db.clawscaleUser.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['cokeAccountId'] },
    });

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_race',
        displayName: 'Race User',
      }),
    ).resolves.toEqual({
      tenantId: 'tnt_raced',
      clawscaleUserId: 'csu_raced',
      created: false,
      ready: true,
    });

    expect(db.identity.upsert).toHaveBeenCalledWith({
      where: { id: graph.identity.id },
      create: {
        ...graph.identity,
        passwordHash: null,
      },
      update: {
        email: graph.identity.email,
        displayName: graph.identity.displayName,
        passwordHash: null,
        claimStatus: graph.identity.claimStatus,
        updatedAt: racedAccount.updatedAt,
      },
    });
    expect(db.customer.upsert).toHaveBeenCalledWith({
      where: { id: graph.customer.id },
      create: graph.customer,
      update: {
        kind: graph.customer.kind,
        displayName: graph.customer.displayName,
        updatedAt: racedAccount.updatedAt,
      },
    });
    expect(db.membership.upsert).toHaveBeenCalledWith({
      where: { id: graph.membership.id },
      create: graph.membership,
      update: {
        identityId: graph.membership.identityId,
        customerId: graph.membership.customerId,
        role: graph.membership.role,
        updatedAt: racedAccount.updatedAt,
      },
    });
    expect(db.agentBinding.create).toHaveBeenCalledWith({
      data: buildLegacyAgentBindingSeed({
        customerId: graph.customer.id,
        agentId: DEFAULT_COKE_AGENT_ID,
      }),
    });
    expect(db.agentBinding.upsert).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount backfills the default Coke Bridge backend for an existing personal tenant', async () => {
    db.clawscaleUser.findUnique.mockResolvedValueOnce({
      id: 'csu_existing',
      tenantId: 'tnt_existing',
    });
    db.aiBackend.findFirst.mockResolvedValueOnce(null);
    db.aiBackend.create.mockResolvedValueOnce({ id: 'aib_bridge' });

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_existing',
      }),
    ).resolves.toEqual({
      tenantId: 'tnt_existing',
      clawscaleUserId: 'csu_existing',
      created: false,
      ready: true,
    });

    expect(db.aiBackend.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tnt_existing', isDefault: true },
      data: { isDefault: false },
    });
    expect(db.aiBackend.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        tenantId: 'tnt_existing',
        name: 'Coke Bridge',
        type: 'custom',
        isActive: true,
        isDefault: true,
        config: {
          baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
          transport: 'http',
          responseFormat: 'json-auto',
          authHeader: 'Bearer dev-bridge-key',
        },
      },
    });
  });
});
