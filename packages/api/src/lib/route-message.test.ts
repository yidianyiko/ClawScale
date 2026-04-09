import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  tenant: { findUnique: vi.fn() },
  endUser: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  conversation: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  message: { create: vi.fn(), findMany: vi.fn() },
  aiBackend: { findMany: vi.fn() },
  endUserBackend: { upsert: vi.fn(), deleteMany: vi.fn() },
}));

const generateReply = vi.hoisted(() => vi.fn());
const getUnifiedConversationIds = vi.hoisted(() => vi.fn());
const bindEndUserToCokeAccount = vi.hoisted(() => vi.fn());
const bindBusinessConversation = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('./ai-backend.js', () => ({ generateReply }));
vi.mock('./clawscale-user.js', () => ({ getUnifiedConversationIds, bindEndUserToCokeAccount }));
vi.mock('./business-conversation.js', () => ({ bindBusinessConversation }));
vi.mock('./clawscale-agent.js', () => ({
  buildSelectionMenu: vi.fn(() => 'menu'),
  runClawscaleAgent: vi.fn(),
}));

import { routeInboundMessage } from './route-message.js';

describe('routeInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });
    db.tenant.findUnique.mockResolvedValue({
      id: 'ten_1',
      settings: {},
    });
    db.endUser.findUnique.mockResolvedValue(null);
    db.endUser.create.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [],
    });
    db.endUser.findMany.mockResolvedValue([{ id: 'eu_1' }, { id: 'eu_2' }]);
    db.conversation.findFirst.mockResolvedValue(null);
    db.conversation.create.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
    });
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_1' }, { id: 'conv_2' }]);
    db.message.create.mockResolvedValue({});
    db.message.findMany.mockResolvedValue([]);
    db.aiBackend.findMany.mockResolvedValue([
      {
        id: 'ab_1',
        tenantId: 'ten_1',
        name: 'Coke Bridge',
        type: 'custom',
        config: {
          baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
          responseFormat: 'json-auto',
        },
        isActive: true,
        isDefault: true,
      },
    ]);
    db.endUserBackend.upsert.mockResolvedValue({});
    db.endUserBackend.deleteMany.mockResolvedValue({});
    db.conversation.update.mockResolvedValue({});
    generateReply.mockResolvedValue('bridge ok');
    bindBusinessConversation.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'wxid_123',
      isActive: true,
    });
    bindEndUserToCokeAccount.mockResolvedValue({
      clawscaleUserId: 'csu_1',
      endUserId: 'eu_1',
      cokeAccountId: 'acct_1',
    });
    getUnifiedConversationIds.mockResolvedValue(['conv_1', 'conv_2']);
  });

  it('binds first-turn business conversation key returned by backend', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
      causalInboundEventId: 'in_evt_prev',
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'first message',
      meta: { platform: 'wechat_personal' },
    });

    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        gatewayConversationId: 'conv_1',
        inboundEventId: expect.any(String),
      }),
    );
    expect(firstGenerateCall?.metadata?.businessConversationKey).toBeUndefined();

    expect(bindBusinessConversation).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      conversationId: 'conv_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'wxid_123',
    });
    expect(bindEndUserToCokeAccount).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      cokeAccountId: 'acct_1',
    });
    const preBindOrder = vi.mocked(bindEndUserToCokeAccount).mock.invocationCallOrder[0];
    const bindOrder = vi.mocked(bindBusinessConversation).mock.invocationCallOrder[0];
    expect(preBindOrder).toBeDefined();
    expect(bindOrder).toBeDefined();
    if (preBindOrder === undefined || bindOrder === undefined) {
      throw new Error('expected both binding calls to have invocation order entries');
    }
    expect(preBindOrder).toBeLessThan(bindOrder);
    expect(db.message.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            outputId: 'out_1',
            causalInboundEventId: 'in_evt_prev',
            businessConversationKey: 'biz_conv_1',
          }),
        }),
      }),
    );
  });

  it('passes stored businessConversationKey to backend for established conversations', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.conversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      businessConversationKey: 'biz_existing',
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'followup',
      meta: { platform: 'wechat_personal' },
    });

    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        gatewayConversationId: 'conv_1',
        businessConversationKey: 'biz_existing',
      }),
    );
    expect(bindBusinessConversation).not.toHaveBeenCalled();
  });

  it('keeps backend reply when post-reply business binding fails', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
    });
    bindBusinessConversation.mockRejectedValueOnce({
      code: 'conversation_binding_conflict',
      message: 'race',
    });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello',
      meta: { platform: 'wechat_personal' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
    expect(db.message.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'bridge ok',
          metadata: expect.objectContaining({
            businessConversationBindingErrorCode: 'conversation_binding_conflict',
            businessConversationBindingErrorMessage: 'business conversation bind failed',
          }),
        }),
      }),
    );
  });

  it('uses personal channel ownership metadata before legacy lookup', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.message.findMany.mockResolvedValue([{ role: 'user', content: 'historical' }]);
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_1' }, { id: 'conv_2' }]);
    getUnifiedConversationIds.mockResolvedValueOnce(['conv_1', 'conv_2']);

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(getUnifiedConversationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'ten_1',
        endUserId: 'eu_1',
        clawscaleUserId: 'csu_1',
        linkedTo: null,
      }),
    );
    expect(generateReply).toHaveBeenCalledOnce();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tenantId: 'ten_1',
          channelId: 'ch_1',
          endUserId: 'eu_1',
          conversationId: 'conv_1',
          externalId: 'wxid_123',
          clawscaleUserId: 'csu_1',
          cokeAccountId: 'acct_1',
          channelScope: 'personal',
        }),
      }),
    );
    expect(db.message.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            channelScope: 'personal',
            clawscaleUserId: 'csu_1',
            cokeAccountId: 'acct_1',
          }),
        }),
      }),
    );
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_1', 'conv_2'] },
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
  });

  it('falls back to current conversation history when unified personal lookup is empty', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.message.findMany.mockResolvedValue([{ role: 'user', content: 'first personal msg' }]);
    getUnifiedConversationIds.mockResolvedValueOnce([]);

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(getUnifiedConversationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'ten_1',
        endUserId: 'eu_1',
        clawscaleUserId: 'csu_1',
        linkedTo: null,
      }),
    );
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_1'] },
        }),
      }),
    );
  });

  it('auto-selects the default backend for an existing personal-channel end user with no active backends', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [],
    });
    db.message.findMany.mockResolvedValue([{ role: 'user', content: 'historical' }]);

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '继续聊',
      meta: { platform: 'wechat_personal' },
    });

    expect(db.endUserBackend.upsert).toHaveBeenCalledWith({
      where: { endUserId_backendId: { endUserId: 'eu_1', backendId: 'ab_1' } },
      create: { endUserId: 'eu_1', backendId: 'ab_1' },
      update: {},
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          channelScope: 'personal',
          cokeAccountId: 'acct_1',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        reply: 'bridge ok',
      }),
    );
  });

  it('uses the current conversation directly for ordinary inbound messages', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(db.endUser.findMany).not.toHaveBeenCalled();
    expect(db.conversation.findMany).not.toHaveBeenCalled();
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_1'] },
        }),
      }),
    );
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          channelScope: 'personal',
          clawscaleUserId: expect.anything(),
          cokeAccountId: expect.anything(),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
  });

  it('falls back to linkedTo when clawscaleUserId is absent', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_2',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_456',
      name: 'Bob',
      status: 'allowed',
      linkedTo: 'eu_legacy',
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.endUser.findMany.mockResolvedValue([{ id: 'eu_legacy' }, { id: 'eu_2' }]);
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_legacy' }]);
    getUnifiedConversationIds.mockResolvedValueOnce(['conv_legacy']);

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_456',
      displayName: 'Bob',
      text: 'hello',
      meta: { platform: 'wechat_personal' },
    });

    expect(getUnifiedConversationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'ten_1',
        endUserId: 'eu_2',
        clawscaleUserId: null,
        linkedTo: 'eu_legacy',
      }),
    );
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_legacy'] },
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
  });

  it('keeps backend name prefixes when multiple active backends reply', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }, { backendId: 'ab_2' }],
    });
    db.aiBackend.findMany.mockResolvedValue([
      {
        id: 'ab_1',
        tenantId: 'ten_1',
        name: 'Coke Bridge',
        type: 'custom',
        config: {
          baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
          responseFormat: 'json-auto',
        },
        isActive: true,
        isDefault: true,
      },
      {
        id: 'ab_2',
        tenantId: 'ten_1',
        name: 'Helper Bot',
        type: 'custom',
        config: {
          baseUrl: 'http://127.0.0.1:8091/bridge/inbound',
          responseFormat: 'json-auto',
        },
        isActive: true,
        isDefault: false,
      },
    ]);
    generateReply
      .mockResolvedValueOnce('bridge ok')
      .mockResolvedValueOnce('helper ok');

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: '[Coke Bridge]\nbridge ok\n\n---\n\n[Helper Bot]\nhelper ok',
      }),
    );
  });
});
