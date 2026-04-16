import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteBindingSnapshot } from './route-binding.js';

const tx = vi.hoisted(() => ({
  conversation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  clawscaleUser: {
    findUnique: vi.fn(),
  },
  deliveryRoute: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const db = vi.hoisted(() => ({
  conversation: {
    findUnique: vi.fn(() => {
      throw new Error('outer conversation.findUnique should not be used in bindBusinessConversation');
    }),
    update: vi.fn(() => {
      throw new Error('outer conversation.update should not be used in bindBusinessConversation');
    }),
  },
  deliveryRoute: {
    upsert: vi.fn(() => {
      throw new Error('outer deliveryRoute.upsert should not be used in bindBusinessConversation');
    }),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  clawscaleUser: {
    findUnique: vi.fn(() => {
      throw new Error('outer clawscaleUser.findUnique should not be used in bindBusinessConversation');
    }),
  },
  $transaction: vi.fn(async (fn: (client: any) => Promise<unknown>) => fn(tx)),
}));

vi.mock('../db/index.js', () => ({ db }));

import {
  BusinessConversationBindingError,
  DeliveryRouteResolutionError,
  bindBusinessConversation,
  invalidateRoutesForChannelReplacement,
  resolveExactDeliveryRoute,
} from './business-conversation.js';

function makeRouteBindingSnapshot(
  overrides: Partial<RouteBindingSnapshot> = {},
): RouteBindingSnapshot {
  return {
    tenantId: 'ten_1',
    channelId: 'ch_1',
    endUserId: 'eu_1',
    externalEndUserId: 'ext_1',
    cokeAccountId: 'acct_1',
    customerId: null,
    gatewayConversationId: 'conv_1',
    businessConversationKey: null,
    previousBusinessConversationKey: null,
    previousClawscaleUserId: null,
    ...overrides,
  };
}

describe('business conversation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bindBusinessConversation writes businessConversationKey and upserts exact route', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      businessConversationKey: null,
      endUser: {
        externalId: 'ext_1',
        clawscaleUserId: 'csu_1',
      },
    });
    tx.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
    });
    tx.conversation.findFirst.mockResolvedValue(null);
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryRoute.upsert.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: true,
    });

    const result = await bindBusinessConversation({
      routeBinding: makeRouteBindingSnapshot(),
      businessConversationKey: 'biz_conv_1',
    });

    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conv_1',
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        businessConversationKey: null,
        clawscaleUserId: null,
      },
      data: {
        clawscaleUserId: 'csu_1',
        businessConversationKey: 'biz_conv_1',
      },
    });
    expect(tx.conversation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.conversation.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'ten_1',
        id: { not: 'conv_1' },
        clawscaleUserId: 'csu_1',
        businessConversationKey: 'biz_conv_1',
      },
      select: {
        id: true,
        clawscaleUserId: true,
        businessConversationKey: true,
      },
    });
    expect(tx.clawscaleUser.findUnique).toHaveBeenCalledWith({
      where: { cokeAccountId: 'acct_1' },
      select: { id: true, tenantId: true },
    });
    expect(tx.deliveryRoute.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.deliveryRoute.upsert).toHaveBeenCalledWith({
      where: {
        cokeAccountId_businessConversationKey: {
          cokeAccountId: 'acct_1',
          businessConversationKey: 'biz_conv_1',
        },
      },
      create: {
        tenantId: 'ten_1',
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_conv_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        externalEndUserId: 'ext_1',
        isActive: true,
      },
      update: {
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        externalEndUserId: 'ext_1',
        isActive: true,
      },
    });
    expect(result).toMatchObject({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: true,
    });
    expect(db.conversation.findUnique).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(db.clawscaleUser.findUnique).not.toHaveBeenCalled();
    expect(db.deliveryRoute.upsert).not.toHaveBeenCalled();
  });

  it('bindBusinessConversation throws conversation_binding_conflict when guarded write loses race', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      clawscaleUserId: null,
      businessConversationKey: 'biz_old',
      endUser: {
        externalId: 'ext_1',
        clawscaleUserId: 'csu_1',
      },
    });
    tx.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
    });
    tx.conversation.findFirst.mockResolvedValue({
      id: 'conv_claimant',
      clawscaleUserId: 'csu_1',
      businessConversationKey: 'biz_conv_1',
    });
    tx.conversation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      bindBusinessConversation({
        routeBinding: makeRouteBindingSnapshot({
          previousBusinessConversationKey: 'biz_old',
        }),
        businessConversationKey: 'biz_conv_1',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessConversationBindingError',
      code: 'conversation_binding_conflict',
    });

    expect(tx.conversation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conv_claimant',
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
        businessConversationKey: 'biz_conv_1',
      },
      data: {
        businessConversationKey: null,
      },
    });
    expect(tx.deliveryRoute.updateMany).not.toHaveBeenCalled();
    expect(tx.deliveryRoute.upsert).not.toHaveBeenCalled();
  });

  it('bindBusinessConversation throws conversation_identity_mismatch when identities do not match', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_other',
      endUserId: 'eu_1',
      businessConversationKey: null,
      endUser: {
        externalId: 'ext_1',
        clawscaleUserId: 'csu_1',
      },
    });

    await expect(
      bindBusinessConversation({
        routeBinding: makeRouteBindingSnapshot(),
        businessConversationKey: 'biz_conv_1',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessConversationBindingError',
      code: 'conversation_identity_mismatch',
    });

    expect(tx.conversation.update).not.toHaveBeenCalled();
    expect(tx.deliveryRoute.upsert).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(db.deliveryRoute.upsert).not.toHaveBeenCalled();
  });

  it('bindBusinessConversation throws external_end_user_mismatch when external identity differs', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      businessConversationKey: null,
      endUser: {
        externalId: 'ext_other',
        clawscaleUserId: 'csu_1',
      },
    });

    await expect(
      bindBusinessConversation({
        routeBinding: makeRouteBindingSnapshot(),
        businessConversationKey: 'biz_conv_1',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessConversationBindingError',
      code: 'external_end_user_mismatch',
    });

    expect(tx.clawscaleUser.findUnique).not.toHaveBeenCalled();
    expect(tx.conversation.update).not.toHaveBeenCalled();
    expect(tx.deliveryRoute.upsert).not.toHaveBeenCalled();
  });

  it('bindBusinessConversation throws coke_account_identity_mismatch when account identity differs', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      businessConversationKey: null,
      endUser: {
        externalId: 'ext_1',
        clawscaleUserId: 'csu_expected',
      },
    });
    tx.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_other',
      tenantId: 'ten_1',
    });

    await expect(
      bindBusinessConversation({
        routeBinding: makeRouteBindingSnapshot(),
        businessConversationKey: 'biz_conv_1',
      }),
    ).rejects.toMatchObject({
      name: 'BusinessConversationBindingError',
      code: 'coke_account_identity_mismatch',
    });

    expect(tx.conversation.update).not.toHaveBeenCalled();
    expect(tx.deliveryRoute.upsert).not.toHaveBeenCalled();
  });

  it('bindBusinessConversation deactivates stale route when rebinding conversation key', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      clawscaleUserId: 'csu_1',
      businessConversationKey: 'biz_old',
      endUser: {
        externalId: 'ext_1',
        clawscaleUserId: 'csu_1',
      },
    });
    tx.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
    });
    tx.conversation.findFirst.mockResolvedValue(null);
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryRoute.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryRoute.upsert.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_new',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: true,
    });

    const result = await bindBusinessConversation({
      routeBinding: makeRouteBindingSnapshot({
        previousBusinessConversationKey: 'biz_old',
        previousClawscaleUserId: 'csu_1',
      }),
      businessConversationKey: 'biz_new',
    });

    expect(tx.deliveryRoute.updateMany).toHaveBeenCalledWith({
      where: {
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_old',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
    expect(result.businessConversationKey).toBe('biz_new');
  });

  it('bindBusinessConversation deactivates both effective and legacy stale keys when they differ', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      clawscaleUserId: 'csu_1',
      businessConversationKey: 'biz_legacy',
      endUser: {
        externalId: 'ext_1',
        clawscaleUserId: 'csu_1',
      },
    });
    tx.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
    });
    tx.conversation.findFirst.mockResolvedValue(null);
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryRoute.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryRoute.upsert.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_new',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: true,
    });

    await bindBusinessConversation({
      routeBinding: makeRouteBindingSnapshot({
        businessConversationKey: 'biz_route',
        previousBusinessConversationKey: 'biz_legacy',
        previousClawscaleUserId: 'csu_1',
      }),
      businessConversationKey: 'biz_new',
    });

    expect(tx.deliveryRoute.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_route',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
    expect(tx.deliveryRoute.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_legacy',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
  });

  it('bindBusinessConversation clears existing business key claim from another conversation in same account context', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      id: 'conv_new',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      clawscaleUserId: null,
      businessConversationKey: null,
      endUser: {
        externalId: 'ext_1',
        clawscaleUserId: 'csu_1',
      },
    });
    tx.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
    });
    tx.conversation.findFirst.mockResolvedValue({
      id: 'conv_old',
      clawscaleUserId: 'csu_1',
      businessConversationKey: 'biz_shared',
    });
    tx.conversation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    tx.deliveryRoute.upsert.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_shared',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: true,
    });

    await bindBusinessConversation({
      routeBinding: makeRouteBindingSnapshot({
        gatewayConversationId: 'conv_new',
      }),
      businessConversationKey: 'biz_shared',
    });

    expect(tx.conversation.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'conv_old',
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
        businessConversationKey: 'biz_shared',
      },
      data: {
        businessConversationKey: null,
      },
    });
    expect(tx.conversation.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'conv_new',
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        businessConversationKey: null,
        clawscaleUserId: null,
      },
      data: {
        clawscaleUserId: 'csu_1',
        businessConversationKey: 'biz_shared',
      },
    });
  });

  it('resolveExactDeliveryRoute returns the exact route', async () => {
    db.deliveryRoute.findUnique.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: true,
    });

    const result = await resolveExactDeliveryRoute({
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
    });

    expect(db.deliveryRoute.findUnique).toHaveBeenCalledWith({
      where: {
        cokeAccountId_businessConversationKey: {
          cokeAccountId: 'acct_1',
          businessConversationKey: 'biz_conv_1',
        },
      },
    });
    expect(result.channelId).toBe('ch_1');
  });

  it('resolveExactDeliveryRoute throws missing_delivery_route when route is absent', async () => {
    db.deliveryRoute.findUnique.mockResolvedValue(null);

    await expect(
      resolveExactDeliveryRoute({
        cokeAccountId: 'acct_404',
        businessConversationKey: 'biz_missing',
      }),
    ).rejects.toMatchObject({
      name: 'DeliveryRouteResolutionError',
      code: 'missing_delivery_route',
    });
  });

  it('resolveExactDeliveryRoute throws missing_delivery_route when route is inactive', async () => {
    db.deliveryRoute.findUnique.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: false,
    });

    await expect(
      resolveExactDeliveryRoute({
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_conv_1',
      }),
    ).rejects.toMatchObject({
      name: 'DeliveryRouteResolutionError',
      code: 'missing_delivery_route',
    });
  });

  it('invalidateRoutesForChannelReplacement marks active routes inactive for the archived channel', async () => {
    db.deliveryRoute.updateMany.mockResolvedValue({ count: 2 });

    const result = await invalidateRoutesForChannelReplacement({
      tenantId: 'ten_1',
      archivedChannelId: 'ch_archived',
    });

    expect(db.deliveryRoute.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'ten_1',
        channelId: 'ch_archived',
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
    expect(result).toEqual({ updatedCount: 2 });
  });
});
