import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client = {
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

describe('clawscale-user helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COKE_BRIDGE_INBOUND_URL = 'http://127.0.0.1:8090/bridge/inbound';
    process.env.COKE_BRIDGE_API_KEY = 'dev-bridge-key';
    db.cokeAccount.findUnique.mockResolvedValue({ id: 'acct_1' });
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
  });

  it('ensureClawscaleUserForCokeAccount reuses an existing mapping', async () => {
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
  });

  it('ensureClawscaleUserForCokeAccount recovers when cokeAccountId create races', async () => {
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
