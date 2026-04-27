import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  channel: {
    findUnique: vi.fn(),
  },
  inboundWebhookReceipt: {
    create: vi.fn(),
  },
}));

const routeInboundMessage = vi.hoisted(() => vi.fn());
const getLineBot = vi.hoisted(() => vi.fn());
const handleLineEvents = vi.hoisted(() => vi.fn());
const getTeamsBot = vi.hoisted(() => vi.fn());
const handleTeamsActivity = vi.hoisted(() => vi.fn());
const verifyWebhook = vi.hoisted(() => vi.fn());
const handleWABusinessWebhook = vi.hoisted(() => vi.fn());
const evolutionSendText = vi.hoisted(() => vi.fn());
const ecloudSendText = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/route-message.js', () => ({ routeInboundMessage }));
vi.mock('../lib/evolution-api.js', () => ({
  EvolutionApiClient: class {
    sendText = evolutionSendText;
  },
}));
vi.mock('../lib/wechat-ecloud-api.js', () => ({
  WechatEcloudApiClient: class {
    sendText = ecloudSendText;
  },
}));
vi.mock('../adapters/line.js', () => ({ getLineBot, handleLineEvents }));
vi.mock('../adapters/teams.js', () => ({ getTeamsBot, handleTeamsActivity }));
vi.mock('../adapters/whatsapp-business.js', () => ({
  verifyWebhook,
  handleWABusinessWebhook,
}));

import { gatewayRouter } from './message-router.js';

describe('gatewayRouter evolution whatsapp route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      type: 'whatsapp_evolution',
      status: 'connected',
      config: {
        webhookToken: 'token_1',
        instanceName: 'coke-whatsapp-personal',
      },
    });
    routeInboundMessage.mockResolvedValue(null);
    evolutionSendText.mockResolvedValue(undefined);
  });

  it('routes whatsapp_evolution inbound messages into routeInboundMessage', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/token_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          key: {
            remoteJid: '8619917902815@s.whatsapp.net',
            fromMe: false,
            id: 'msg_1',
          },
          pushName: 'Alice',
          message: {
            conversation: 'hello from evolution',
          },
          messageType: 'conversation',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith({
      channelId: 'ch_1',
      externalId: '8619917902815',
      displayName: 'Alice',
      text: 'hello from evolution',
      meta: {
        platform: 'whatsapp_evolution',
        instanceName: 'coke-whatsapp-personal',
        messageId: 'msg_1',
        messageType: 'conversation',
        remoteJid: '8619917902815@s.whatsapp.net',
      },
    });
  });

  it('sends immediate replies back through Evolution when routing returns a reply', async () => {
    routeInboundMessage.mockResolvedValueOnce({
      conversationId: 'conv_1',
      replies: [{ backendId: null, backendName: 'ClawScale Assistant', reply: 'hello back' }],
      reply: 'hello back',
    });

    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/token_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          key: {
            remoteJid: '8619917902815@s.whatsapp.net',
            fromMe: false,
            id: 'msg_reply',
          },
          pushName: 'Alice',
          message: {
            conversation: 'hello from evolution',
          },
          messageType: 'conversation',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(evolutionSendText).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      '8619917902815',
      'hello back',
    );
  });

  it('uses extendedTextMessage text when conversation is absent', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/token_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          key: {
            remoteJid: '8619917902815@s.whatsapp.net',
            fromMe: false,
            id: 'msg_2',
          },
          pushName: 'Alice',
          message: {
            extendedTextMessage: {
              text: 'hello from extended text',
            },
          },
          messageType: 'extendedTextMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '8619917902815',
        text: 'hello from extended text',
        meta: expect.objectContaining({
          instanceName: 'coke-whatsapp-personal',
          messageId: 'msg_2',
          messageType: 'extendedTextMessage',
        }),
      }),
    );
  });

  it('rejects invalid webhook tokens', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/wrong-token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          key: {
            remoteJid: '8619917902815@s.whatsapp.net',
            fromMe: false,
            id: 'msg_token',
          },
          message: {
            conversation: 'hello',
          },
        },
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Forbidden' });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('ignores malformed json payloads with 200', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/token_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('ignores fromMe=true payloads with 200', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/token_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          key: {
            remoteJid: '8619917902815@s.whatsapp.net',
            fromMe: true,
            id: 'msg_1',
          },
          pushName: 'Alice',
          message: {
            conversation: 'hello from me',
          },
          messageType: 'conversation',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('ignores group messages with 200', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/token_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          key: {
            remoteJid: '12345@g.us',
            fromMe: false,
            id: 'msg_group',
          },
          pushName: 'Group User',
          message: {
            conversation: 'hello group',
          },
          messageType: 'conversation',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('swallows downstream routing errors and still returns 200', async () => {
    routeInboundMessage.mockRejectedValueOnce(new Error('backend down'));

    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/evolution/whatsapp/ch_1/token_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          key: {
            remoteJid: '8619917902815@s.whatsapp.net',
            fromMe: false,
            id: 'msg_err',
          },
          pushName: 'Alice',
          message: {
            conversation: 'hello failure',
          },
          messageType: 'conversation',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});

describe('gatewayRouter ecloud wechat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_ecloud',
      type: 'wechat_ecloud',
      status: 'connected',
      config: {
        appId: 'app_1',
        token: 'api_token_1',
        baseUrl: 'https://api.example.test',
        webhookToken: 'webhook_token_1',
      },
    });
    db.inboundWebhookReceipt.create.mockResolvedValue({ id: 'receipt_1' });
    routeInboundMessage.mockResolvedValue(null);
    ecloudSendText.mockResolvedValue(undefined);
  });

  it('routes valid text callbacks into routeInboundMessage', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageType: '60001',
        data: {
          self: false,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          nickName: 'Alice',
          content: '  hello from ecloud  ',
          msgId: 123,
          newMsgId: '456',
          timestamp: 1710000000,
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(db.inboundWebhookReceipt.create).toHaveBeenCalledWith({
      data: {
        channelId: 'ch_ecloud',
        provider: 'wechat_ecloud',
        idempotencyKey: 'ch_ecloud:456',
        payload: expect.objectContaining({ messageType: '60001' }),
      },
    });
    expect(routeInboundMessage).toHaveBeenCalledWith({
      channelId: 'ch_ecloud',
      externalId: 'wxid_user',
      displayName: 'Alice',
      text: 'hello from ecloud',
      meta: {
        platform: 'wechat_ecloud',
        appId: 'app_1',
        messageType: '60001',
        msgId: 123,
        newMsgId: '456',
        toUser: 'wxid_bot',
        fromUser: 'wxid_user',
        timestamp: 1710000000,
      },
    });
  });

  it('falls back to external id as displayName when text callbacks omit nicknames', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageType: '60001',
        data: {
          self: false,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          content: 'hello from ecloud',
          msgId: 'msg_fallback',
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'wxid_user',
        displayName: 'wxid_user',
        text: 'hello from ecloud',
      }),
    );
  });

  it('routes valid reference callbacks', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageType: '60014',
        data: {
          self: false,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          title: 'Alice',
          content: 'quoted reply',
          msgId: 'msg_1',
          refermsg: {
            content: '<msg><displayname>Alice</displayname><content>original</content></msg>',
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch_ecloud',
        externalId: 'wxid_user',
        displayName: 'Alice',
        text: 'quoted reply',
        meta: expect.objectContaining({
          platform: 'wechat_ecloud',
          reference: {
            displayname: 'Alice',
            content: 'original',
          },
        }),
      }),
    );
  });

  it('deduplicates callbacks by newMsgId', async () => {
    db.inboundWebhookReceipt.create
      .mockResolvedValueOnce({ id: 'receipt_1' })
      .mockRejectedValueOnce({ code: 'P2002' });

    const app = new Hono();
    app.route('/gateway', gatewayRouter);
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageType: '60001',
        data: {
          self: false,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          content: 'hello',
          msgId: 123,
          newMsgId: '456',
        },
      }),
    };

    const first = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', request);
    const second = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', request);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.inboundWebhookReceipt.create).toHaveBeenCalledTimes(2);
    expect(routeInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid webhook tokens', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ecloud/wechat/ch_ecloud/wrong_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Forbidden' });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('returns 404 for disconnected or wrong type channels', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_ecloud',
      type: 'wechat_ecloud',
      status: 'disconnected',
      config: {},
    });
    const disconnected = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_ecloud',
      type: 'whatsapp_evolution',
      status: 'connected',
      config: {},
    });
    const wrongType = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(disconnected.status).toBe(404);
    expect(wrongType.status).toBe(404);
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('ignores malformed, self, group, and unsupported callbacks with 200', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);
    const payloads = [
      '{',
      JSON.stringify({
        messageType: '60001',
        data: {
          self: true,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          content: 'self',
          msgId: 'self_msg',
        },
      }),
      JSON.stringify({
        messageType: '60001',
        data: {
          self: false,
          fromUser: 'room@chatroom',
          toUser: 'wxid_bot',
          content: 'group',
          msgId: 'group_msg',
        },
      }),
      JSON.stringify({
        messageType: '60004',
        data: {
          self: false,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          content: 'voice',
          msgId: 'voice_msg',
        },
      }),
    ];

    for (const body of payloads) {
      const res = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    }

    expect(routeInboundMessage).not.toHaveBeenCalled();
    expect(db.inboundWebhookReceipt.create).not.toHaveBeenCalled();
  });

  it('swallows downstream routing errors and still returns 200', async () => {
    routeInboundMessage.mockRejectedValueOnce(new Error('backend down'));
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageType: '60001',
        data: {
          self: false,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          content: 'hello failure',
          msgId: 'msg_err',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('sends immediate replies through Ecloud client', async () => {
    routeInboundMessage.mockResolvedValueOnce({
      conversationId: 'conv_1',
      replies: [{ backendId: null, backendName: 'ClawScale Assistant', reply: 'hello back' }],
      reply: 'hello back',
    });
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ecloud/wechat/ch_ecloud/webhook_token_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageType: '60001',
        data: {
          self: false,
          fromUser: 'wxid_user',
          toUser: 'wxid_bot',
          content: 'hello',
          msgId: 'msg_reply',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(ecloudSendText).toHaveBeenCalledWith('app_1', 'wxid_user', 'hello back');
  });
});
