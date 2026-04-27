import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';

const db = vi.hoisted(() => ({
  channel: {
    findUnique: vi.fn(),
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
const linqCreateChat = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/route-message.js', () => ({ routeInboundMessage }));
vi.mock('../lib/evolution-api.js', () => ({
  EvolutionApiClient: class {
    sendText = evolutionSendText;
  },
}));
vi.mock('../lib/linq-api.js', () => ({
  LinqApiClient: class {
    createChat = linqCreateChat;
  },
}));
vi.mock('../adapters/line.js', () => ({ getLineBot, handleLineEvents }));
vi.mock('../adapters/teams.js', () => ({ getTeamsBot, handleTeamsActivity }));
vi.mock('../adapters/whatsapp-business.js', () => ({
  verifyWebhook,
  handleWABusinessWebhook,
}));

import { gatewayRouter } from './message-router.js';

const linqConfig = {
  fromNumber: '+13213108456',
  webhookToken: 'token_1',
  webhookSubscriptionId: 'sub_1',
  signingSecret: 'secret_1',
};

function createApp() {
  const app = new Hono();
  app.route('/gateway', gatewayRouter);
  return app;
}

function signLinqBody(body: string, timestamp: string, secret = linqConfig.signingSecret) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function postLinqWebhook({
  channelId = 'ch_linq',
  token = linqConfig.webhookToken,
  body,
  timestamp = String(Math.floor(Date.now() / 1000)),
  signature,
  subscriptionId = linqConfig.webhookSubscriptionId,
}: {
  channelId?: string;
  token?: string;
  body: string;
  timestamp?: string;
  signature?: string;
  subscriptionId?: string;
}) {
  return createApp().request(`/gateway/linq/${channelId}/${token}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Signature': signature ?? signLinqBody(body, timestamp),
      'X-Webhook-Subscription-ID': subscriptionId,
    },
    body,
  });
}

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

describe('gatewayRouter linq route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_linq',
      type: 'linq',
      status: 'connected',
      config: linqConfig,
    });
    routeInboundMessage.mockResolvedValue(null);
    linqCreateChat.mockResolvedValue(undefined);
  });

  it('routes signed message.received webhooks into routeInboundMessage', async () => {
    const body = JSON.stringify({
      event_type: 'message.received',
      event_id: 'evt_1',
      data: {
        direction: 'inbound',
        sender_handle: { handle: '+86 152 017 80593' },
        chat: {
          id: 'chat_1',
          owner_handle: { handle: '+1 (321) 310-8456' },
        },
        message: {
          id: 'msg_1',
          parts: [
            { type: 'text', value: ' hello ' },
            { type: 'image', value: 'ignored' },
            { type: 'text', text: 'second line' },
            { type: 'text', value: '   ' },
          ],
        },
        service: 'sms',
      },
    });

    const res = await postLinqWebhook({ body });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith({
      channelId: 'ch_linq',
      externalId: '+8615201780593',
      displayName: '+86 152 017 80593',
      text: 'hello\nsecond line',
      meta: {
        platform: 'linq',
        eventId: 'evt_1',
        chatId: 'chat_1',
        messageId: 'msg_1',
        service: 'sms',
        ownerHandle: '+1 (321) 310-8456',
        webhookSubscriptionId: 'sub_1',
      },
    });
  });

  it('sends immediate replies to the inbound sender rather than the owner handle', async () => {
    routeInboundMessage.mockResolvedValueOnce({
      conversationId: 'conv_1',
      replies: [{ backendId: null, backendName: 'ClawScale Assistant', reply: 'hello back' }],
      reply: 'hello back',
    });
    const body = JSON.stringify({
      event_type: 'message.received',
      event_id: 'evt_reply',
      data: {
        sender_handle: { handle: '+86 152 017 80593' },
        chat: {
          id: 'chat_reply',
          owner_handle: { handle: '+1 (321) 310-8456' },
        },
        parts: [{ type: 'text', value: 'hello' }],
        message: { id: 'msg_reply' },
      },
    });

    const res = await postLinqWebhook({ body });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(linqCreateChat).toHaveBeenCalledWith({
      from: '+13213108456',
      to: ['+8615201780593'],
      text: 'hello back',
    });
    expect(linqCreateChat).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: ['+13213108456'] }),
    );
  });

  it('rejects connected linq channels missing signingSecret', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      type: 'linq',
      status: 'connected',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'token_1',
        webhookSubscriptionId: 'sub_1',
      },
    });
    const body = JSON.stringify({
      event_type: 'message.received',
      data: {
        sender_handle: { handle: '+86 152 017 80593' },
        parts: [{ type: 'text', value: 'hello' }],
      },
    });

    const res = await postLinqWebhook({ body });

    expect(res.status).toBe(403);
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('ignores invalid JSON after a valid signature with 200', async () => {
    const res = await postLinqWebhook({ body: '{' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['stale timestamp', { timestamp: String(Math.floor(Date.now() / 1000) - 301) }],
    ['malformed signature', { signature: 'not-hex' }],
    ['bad signature', { signature: '0'.repeat(64) }],
    ['missing subscription id', { subscriptionId: '' }],
    ['mismatched subscription id', { subscriptionId: 'sub_wrong' }],
  ])('rejects %s with 403', async (_name, override) => {
    const body = JSON.stringify({
      event_type: 'message.received',
      data: {
        sender_handle: { handle: '+86 152 017 80593' },
        parts: [{ type: 'text', value: 'hello' }],
      },
    });

    const timestamp =
      'timestamp' in override && override.timestamp
        ? override.timestamp
        : String(Math.floor(Date.now() / 1000));
    const res = await postLinqWebhook({
      body,
      timestamp,
      signature:
        'signature' in override && override.signature
          ? override.signature
          : signLinqBody(body, timestamp),
      subscriptionId:
        'subscriptionId' in override && override.subscriptionId !== undefined
          ? override.subscriptionId
          : linqConfig.webhookSubscriptionId,
    });

    expect(res.status).toBe(403);
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('ignores non-message events and outbound or self messages with 200', async () => {
    const ignoredPayloads = [
      { event_type: 'message.created', data: { parts: [{ type: 'text', value: 'hello' }] } },
      {
        event_type: 'message.received',
        data: {
          direction: 'outbound',
          sender_handle: { handle: '+86 152 017 80593' },
          parts: [{ type: 'text', value: 'hello' }],
        },
      },
      {
        event_type: 'message.received',
        data: {
          is_from_me: true,
          sender_handle: { handle: '+86 152 017 80593' },
          parts: [{ type: 'text', value: 'hello' }],
        },
      },
    ];

    for (const payload of ignoredPayloads) {
      const res = await postLinqWebhook({ body: JSON.stringify(payload) });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    }
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });
});
