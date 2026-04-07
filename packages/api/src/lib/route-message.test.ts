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

vi.mock('../db/index.js', () => ({ db }));
vi.mock('./ai-backend.js', () => ({ generateReply }));
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
  });

  it('passes unified routing metadata and resolves unified history by clawscale user first', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: 'eu_legacy',
      clawscaleUserId: 'csu_1',
      clawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.message.findMany.mockResolvedValue([{ role: 'user', content: 'historical' }]);
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_1' }, { id: 'conv_2' }]);

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(db.endUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'ten_1',
          clawscaleUserId: 'csu_1',
        }),
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
        },
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
});
