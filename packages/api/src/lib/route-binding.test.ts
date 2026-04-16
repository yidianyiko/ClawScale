import { describe, expect, it } from 'vitest';

import {
  createRouteBindingSnapshot,
  deriveRouteBindingRecordFromConversation,
  collectBackfillRouteBindingRecords,
} from './route-binding.js';

describe('route binding helpers', () => {
  it('prefers active delivery-route businessConversationKey over legacy gateway state', () => {
    const snapshot = createRouteBindingSnapshot({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      customerId: 'cust_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      cokeAccountId: 'acct_1',
      gatewayConversationId: 'conv_1',
      previousBusinessConversationKey: 'biz_legacy',
      previousClawscaleUserId: 'csu_legacy',
      deliveryRoute: {
        businessConversationKey: 'biz_route',
      },
    });

    expect(snapshot).toEqual({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      cokeAccountId: 'acct_1',
      customerId: 'cust_1',
      gatewayConversationId: 'conv_1',
      businessConversationKey: 'biz_route',
      previousBusinessConversationKey: 'biz_legacy',
      previousClawscaleUserId: 'csu_legacy',
    });
  });

  it('falls back to legacy gateway businessConversationKey when no active delivery route exists', () => {
    const snapshot = createRouteBindingSnapshot({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      customerId: null,
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      cokeAccountId: null,
      gatewayConversationId: 'conv_1',
      previousBusinessConversationKey: 'biz_legacy',
      previousClawscaleUserId: null,
      deliveryRoute: null,
    });

    expect(snapshot.businessConversationKey).toBe('biz_legacy');
    expect(snapshot.gatewayConversationId).toBe('conv_1');
  });

  it('derives a minimal route-binding record from a legacy conversation row', () => {
    const record = deriveRouteBindingRecordFromConversation({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      businessConversationKey: 'biz_conv_1',
      endUser: {
        externalId: 'ext_1',
      },
      clawscaleUser: {
        cokeAccountId: 'acct_1',
      },
    });

    expect(record).toEqual({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'ext_1',
      isActive: true,
    });
  });

  it('skips legacy conversations that cannot produce a minimal route binding', () => {
    expect(
      deriveRouteBindingRecordFromConversation({
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        businessConversationKey: null,
        endUser: {
          externalId: 'ext_1',
        },
        clawscaleUser: {
          cokeAccountId: 'acct_1',
        },
      }),
    ).toBeNull();
  });

  it('collects deterministic backfill records when duplicates are identical', () => {
    const result = collectBackfillRouteBindingRecords([
      {
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        businessConversationKey: 'biz_conv_1',
        endUser: { externalId: 'ext_1' },
        clawscaleUser: { cokeAccountId: 'acct_1' },
      },
      {
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        businessConversationKey: 'biz_conv_1',
        endUser: { externalId: 'ext_1' },
        clawscaleUser: { cokeAccountId: 'acct_1' },
      },
    ]);

    expect(result.records).toEqual([
      {
        tenantId: 'ten_1',
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_conv_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        externalEndUserId: 'ext_1',
        isActive: true,
      },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it('reports conflicting backfill records for the same composite key', () => {
    const result = collectBackfillRouteBindingRecords([
      {
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        businessConversationKey: 'biz_conv_1',
        endUser: { externalId: 'ext_1' },
        clawscaleUser: { cokeAccountId: 'acct_1' },
      },
      {
        tenantId: 'ten_1',
        channelId: 'ch_2',
        endUserId: 'eu_2',
        businessConversationKey: 'biz_conv_1',
        endUser: { externalId: 'ext_2' },
        clawscaleUser: { cokeAccountId: 'acct_1' },
      },
    ]);

    expect(result.records).toEqual([]);
    expect(result.conflicts).toEqual([
      {
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_conv_1',
        records: [
          {
            tenantId: 'ten_1',
            cokeAccountId: 'acct_1',
            businessConversationKey: 'biz_conv_1',
            channelId: 'ch_1',
            endUserId: 'eu_1',
            externalEndUserId: 'ext_1',
            isActive: true,
          },
          {
            tenantId: 'ten_1',
            cokeAccountId: 'acct_1',
            businessConversationKey: 'biz_conv_1',
            channelId: 'ch_2',
            endUserId: 'eu_2',
            externalEndUserId: 'ext_2',
            isActive: true,
          },
        ],
      },
    ]);
  });
});
