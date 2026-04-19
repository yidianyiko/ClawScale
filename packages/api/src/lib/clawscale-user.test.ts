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
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    agentBinding: {
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
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    cokeAccount: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
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
  ClawscaleUserBindingError,
  ensureClawscaleUserForCustomer,
  ensureClawscaleUserForCokeAccount,
  getUnifiedConversationIds,
} from './clawscale-user.js';
import {
  DEFAULT_COKE_AGENT_ID,
  buildLegacyAgentBindingSeed,
} from './platformization-migration.js';

const defaultCustomerOwnership = {
  customer: {
    id: 'ck_customer_1',
    displayName: 'Alice',
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  },
  identity: {
    id: 'idt_1',
    email: 'Alice@Example.com',
    displayName: 'Alice',
    passwordHash: 'hashed-password',
    claimStatus: 'active',
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  },
  role: 'owner',
} as const;

describe('clawscale-user helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.COKE_BRIDGE_INBOUND_URL = 'http://127.0.0.1:8090/bridge/inbound';
    process.env.COKE_BRIDGE_API_KEY = 'dev-bridge-key';
    db.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(db));
    db.membership.findFirst.mockResolvedValue(defaultCustomerOwnership);
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
        cokeAccountId: 'ck_customer_1',
      }),
    ).resolves.toEqual({
      clawscaleUserId: 'csu_1',
      endUserId: 'eu_1',
      cokeAccountId: 'ck_customer_1',
    });

    expect(db.clawscaleUser.findUnique).toHaveBeenCalledWith({
      where: { cokeAccountId: 'ck_customer_1' },
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
          OR: [{ clawscaleUserId: null }, { clawscaleUserId: 'csu_1' }],
        },
        data: { clawscaleUserId: 'csu_1' },
      }),
    );
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
        cokeAccountId: 'ck_customer_1',
      }),
    ).rejects.toMatchObject({ code: 'end_user_already_bound' });
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
        cokeAccountId: 'ck_missing',
      }),
    ).rejects.toMatchObject({ code: 'coke_account_not_found' });

    expect(db.endUser.updateMany).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCustomer creates a personal tenant without touching compatibility coke_accounts rows', async () => {
    db.clawscaleUser.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(
      ensureClawscaleUserForCustomer({
        customerId: defaultCustomerOwnership.customer.id,
      }),
    ).resolves.toEqual({
      tenantId: expect.any(String),
      clawscaleUserId: expect.any(String),
      created: true,
      ready: true,
    });

    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: defaultCustomerOwnership.customer.id,
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            id: true,
            displayName: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        identity: {
          select: {
            id: true,
            email: true,
            displayName: true,
            passwordHash: true,
            claimStatus: true,
            updatedAt: true,
          },
        },
      },
    });
    expect(db.tenant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'personal-ck_customer_1',
        name: "Alice's Workspace",
        settings: expect.objectContaining({
          ownerCokeAccountId: 'ck_customer_1',
        }),
      }),
    });
    expect(db.clawscaleUser.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        tenantId: expect.any(String),
        cokeAccountId: 'ck_customer_1',
      },
    });
    expect(db.agentBinding.upsert).toHaveBeenCalledWith({
      where: { customerId: defaultCustomerOwnership.customer.id },
      create: buildLegacyAgentBindingSeed({
        customerId: defaultCustomerOwnership.customer.id,
        agentId: DEFAULT_COKE_AGENT_ID,
      }),
      update: {
        agentId: DEFAULT_COKE_AGENT_ID,
        provisionStatus: 'ready',
        provisionAttempts: 0,
        provisionLastError: null,
      },
    });
    expect(db.cokeAccount.upsert).not.toHaveBeenCalled();
    expect(db.identity.upsert).not.toHaveBeenCalled();
    expect(db.customer.upsert).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount resolves ck_ compatibility ids through customer ownership only', async () => {
    db.clawscaleUser.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'ck_customer_1',
        displayName: 'Ignored Alias Name',
      }),
    ).resolves.toEqual({
      tenantId: expect.any(String),
      clawscaleUserId: expect.any(String),
      created: true,
      ready: true,
    });

    expect(db.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId: 'ck_customer_1',
          role: 'owner',
        },
      }),
    );
    expect(db.cokeAccount.findUnique).not.toHaveBeenCalled();
    expect(db.cokeAccount.upsert).not.toHaveBeenCalled();
    expect(db.identity.upsert).not.toHaveBeenCalled();
    expect(db.customer.upsert).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount returns a compatibility not-found error when the owner membership is missing', async () => {
    db.membership.findFirst.mockResolvedValueOnce(null);

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'ck_missing',
      }),
    ).rejects.toMatchObject({ code: 'coke_account_not_found' });

    expect(db.tenant.create).not.toHaveBeenCalled();
    expect(db.clawscaleUser.create).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount rejects legacy non-customer compatibility ids', async () => {
    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'acct_legacy_only',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'coke_account_not_found',
      }),
    );

    expect(db.membership.findFirst).not.toHaveBeenCalled();
    expect(db.cokeAccount.findUnique).not.toHaveBeenCalled();
  });

  it('ensureClawscaleUserForCokeAccount reuses an existing mapping and refreshes the backend', async () => {
    db.clawscaleUser.findUnique.mockResolvedValueOnce({
      id: 'csu_existing',
      tenantId: 'tnt_existing',
    });
    db.aiBackend.findFirst.mockResolvedValueOnce(null);
    db.aiBackend.create.mockResolvedValueOnce({ id: 'aib_bridge' });

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'ck_customer_1',
      }),
    ).resolves.toEqual({
      tenantId: 'tnt_existing',
      clawscaleUserId: 'csu_existing',
      created: false,
      ready: true,
    });

    expect(db.tenant.create).not.toHaveBeenCalled();
    expect(db.clawscaleUser.create).not.toHaveBeenCalled();
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

  it('ensureClawscaleUserForCokeAccount propagates compatibility agent-binding failures', async () => {
    const bindingError = new Error('default agent binding unavailable');
    db.agentBinding.upsert.mockRejectedValueOnce(bindingError);

    await expect(
      ensureClawscaleUserForCokeAccount({
        cokeAccountId: 'ck_customer_1',
      }),
    ).rejects.toThrow(bindingError);
  });

  it('ensureClawscaleUserForCustomer rejects customers without a provisionable owner identity', async () => {
    db.membership.findFirst.mockResolvedValueOnce({
      ...defaultCustomerOwnership,
      identity: {
        ...defaultCustomerOwnership.identity,
        email: null,
      },
    });

    await expect(
      ensureClawscaleUserForCustomer({
        customerId: defaultCustomerOwnership.customer.id,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ClawscaleUserBindingError>>({
        code: 'customer_not_found',
      }),
    );
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
});
