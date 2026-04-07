import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client = {
    endUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    clawscaleUser: {
      upsert: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(client)),
  } as any;
  return client;
});

vi.mock('../db/index.js', () => ({ db }));

import { bindEndUserToCokeAccount, getUnifiedConversationIds } from './clawscale-user.js';

describe('clawscale-user helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bindEndUserToCokeAccount upserts a tenant-scoped ClawscaleUser and attaches an EndUser', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'ext_1',
      clawscaleUserId: null,
    });
    db.clawscaleUser.upsert.mockResolvedValue({ id: 'csu_1' });
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

    expect(db.clawscaleUser.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_cokeAccountId: {
            tenantId: 'ten_1',
            cokeAccountId: 'acct_1',
          },
        },
      }),
    );
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
    db.clawscaleUser.upsert.mockResolvedValue({ id: 'csu_new' });
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
