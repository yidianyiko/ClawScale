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

vi.mock('../db/index.js', () => ({ db }));
vi.mock('./ai-backend.js', () => ({ generateReply }));
vi.mock('./clawscale-user.js', () => ({ getUnifiedConversationIds }));
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
    getUnifiedConversationIds.mockResolvedValue(['conv_1', 'conv_2']);
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
        metadata: {
          tenantId: 'ten_1',
          channelId: 'ch_1',
          endUserId: 'eu_1',
          conversationId: 'conv_1',
          externalId: 'wxid_123',
          clawscaleUserId: 'csu_1',
          cokeAccountId: 'acct_1',
          channelScope: 'personal',
        },
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
        reply: '[Coke Bridge]\nbridge ok',
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
        reply: expect.stringContaining('bridge ok'),
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
        reply: expect.stringContaining('bridge ok'),
      }),
    );
  });
});
