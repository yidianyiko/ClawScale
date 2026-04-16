import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../lib/business-conversation.js', () => ({
  bindBusinessConversation: vi.fn(),
}));
vi.mock('../lib/clawscale-user.js', () => ({
  bindEndUserToCokeAccount: vi.fn(),
}));

import { bindBusinessConversation } from '../lib/business-conversation.js';
import { bindEndUserToCokeAccount } from '../lib/clawscale-user.js';
import { cokeDeliveryRoutesRouter } from './coke-delivery-routes.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/internal/coke-delivery', cokeDeliveryRoutesRouter);
  return app;
}

describe('coke-delivery-routes router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAWSCALE_IDENTITY_API_KEY = 'secret';
  });

  it('rejects invalid bearer tokens', async () => {
    const app = makeApp();

    const res = await app.request('/api/internal/coke-delivery', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        conversation_id: 'conv_1',
        account_id: 'acct_1',
        business_conversation_key: 'biz_conv_1',
        channel_id: 'ch_1',
        end_user_id: 'eu_1',
        external_end_user_id: 'wxid_1',
      }),
    });

    expect(res.status).toBe(401);
    expect(bindBusinessConversation).not.toHaveBeenCalled();
  });

  it('binds and upserts business conversation route for cutover/backfill', async () => {
    vi.mocked(bindEndUserToCokeAccount).mockResolvedValue({
      clawscaleUserId: 'csu_1',
      endUserId: 'eu_1',
      cokeAccountId: 'acct_1',
    });
    vi.mocked(bindBusinessConversation).mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'wxid_1',
      isActive: true,
    });

    const app = makeApp();

    const res = await app.request('/api/internal/coke-delivery', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        conversation_id: 'conv_1',
        account_id: 'acct_1',
        business_conversation_key: 'biz_conv_1',
        channel_id: 'ch_1',
        end_user_id: 'eu_1',
        external_end_user_id: 'wxid_1',
      }),
    });

    expect(res.status).toBe(200);
    expect(bindEndUserToCokeAccount).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_1',
      cokeAccountId: 'acct_1',
    });
    expect(bindBusinessConversation).toHaveBeenCalledWith({
      routeBinding: {
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        externalEndUserId: 'wxid_1',
        cokeAccountId: 'acct_1',
        customerId: null,
        gatewayConversationId: 'conv_1',
        businessConversationKey: null,
        previousBusinessConversationKey: null,
        previousClawscaleUserId: null,
      },
      businessConversationKey: 'biz_conv_1',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        tenant_id: 'ten_1',
        account_id: 'acct_1',
        business_conversation_key: 'biz_conv_1',
        channel_id: 'ch_1',
        end_user_id: 'eu_1',
        external_end_user_id: 'wxid_1',
        is_active: true,
      },
    });
  });

  it('fails when pre-binding cannot resolve the end user', async () => {
    vi.mocked(bindEndUserToCokeAccount).mockRejectedValue({ code: 'end_user_not_found' });

    const app = makeApp();

    const res = await app.request('/api/internal/coke-delivery', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        conversation_id: 'conv_1',
        account_id: 'acct_1',
        business_conversation_key: 'biz_conv_1',
        channel_id: 'ch_1',
        end_user_id: 'eu_1',
        external_end_user_id: 'wxid_1',
      }),
    });

    expect(res.status).toBe(404);
    expect(bindBusinessConversation).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed request bodies and does not call helper', async () => {
    const app = makeApp();

    const res = await app.request('/api/internal/coke-delivery', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: '{',
    });

    expect(res.status).toBe(400);
    expect(bindBusinessConversation).not.toHaveBeenCalled();
  });
});
