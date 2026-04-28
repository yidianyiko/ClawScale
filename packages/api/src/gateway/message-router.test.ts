import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';

const db = vi.hoisted(() => ({
  channel: {
    findUnique: vi.fn(),
  },
  inboundWebhookReceipt: {
    create: vi.fn(),
  },
}));

const routeInboundMessage = vi.hoisted(() => vi.fn());
const evolutionSendText = vi.hoisted(() => vi.fn());
const ecloudSendText = vi.hoisted(() => vi.fn());
const linqCreateChat = vi.hoisted(() => vi.fn());

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
vi.mock('../lib/linq-api.js', () => ({
  LinqApiClient: class {
    createChat = linqCreateChat;
  },
}));

import { gatewayRouter } from './message-router.js';

const messageRouterSource = readFileSync(new URL('./message-router.ts', import.meta.url), 'utf8');

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

describe('gatewayRouter active webhook topology', () => {
  it('does not expose retired generic channel webhooks', () => {
    expect(messageRouterSource).not.toContain("from '../adapters/line.js'");
    expect(messageRouterSource).not.toContain("from '../adapters/teams.js'");
    expect(messageRouterSource).not.toContain("from '../adapters/whatsapp-business.js'");
    expect(messageRouterSource).not.toContain("'/whatsapp/:channelId'");
    expect(messageRouterSource).not.toContain("'/line/:channelId'");
    expect(messageRouterSource).not.toContain("'/teams/:channelId'");
  });

  it('keeps the active shared-channel webhooks', () => {
    expect(messageRouterSource).toContain("'/evolution/whatsapp/:channelId/:token'");
    expect(messageRouterSource).toContain("'/ecloud/wechat/:channelId/:token'");
    expect(messageRouterSource).toContain("'/linq/:channelId/:token'");
  });
});

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

  it('routes imageMessage caption and attachment into routeInboundMessage', async () => {
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
            id: 'msg_image',
          },
          pushName: 'Alice',
          message: {
            imageMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7118-24/photo.jpg',
              caption: 'look at this',
              mimetype: 'image/jpeg',
              fileLength: '12345',
            },
          },
          messageType: 'imageMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '8619917902815',
        text: 'look at this',
        attachments: [
          expect.objectContaining({
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/photo.jpg',
            filename: 'attachment',
            contentType: 'image/jpeg',
            size: 12345,
          }),
        ],
        attachmentPolicy: { allowDataUrls: false },
      }),
    );
  });

  it('routes audioMessage without text as attachment-only input', async () => {
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
            id: 'msg_audio',
          },
          pushName: 'Alice',
          message: {
            audioMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio.ogg',
              mimetype: 'audio/ogg',
              fileLength: 6789,
            },
          },
          messageType: 'audioMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '8619917902815',
        text: '',
        attachments: [
          expect.objectContaining({
            url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio.ogg',
            filename: 'attachment',
            contentType: 'audio/ogg',
            size: 6789,
          }),
        ],
        attachmentPolicy: { allowDataUrls: false },
      }),
    );
  });

  it('routes audioMessage caption as text with attachment', async () => {
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
            id: 'msg_audio_caption',
          },
          pushName: 'Alice',
          message: {
            audioMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio.ogg',
              caption: 'voice note caption',
              mimetype: 'audio/ogg',
              fileLength: 6789,
            },
          },
          messageType: 'audioMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '8619917902815',
        text: 'voice note caption',
        attachments: [
          expect.objectContaining({
            url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio.ogg',
            filename: 'attachment',
            contentType: 'audio/ogg',
            size: 6789,
          }),
        ],
        attachmentPolicy: { allowDataUrls: false },
      }),
    );
  });

  it('routes videoMessage without text as attachment-only input', async () => {
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
            id: 'msg_video',
          },
          pushName: 'Alice',
          message: {
            videoMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7161-24/video.mp4',
              mimetype: 'video/mp4',
              fileLength: '13579',
            },
          },
          messageType: 'videoMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '8619917902815',
        text: '',
        attachments: [
          expect.objectContaining({
            url: 'https://mmg.whatsapp.net/v/t62.7161-24/video.mp4',
            filename: 'attachment',
            contentType: 'video/mp4',
            size: 13579,
          }),
        ],
        attachmentPolicy: { allowDataUrls: false },
      }),
    );
  });

  it('routes documentMessage filename and attachment metadata', async () => {
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
            id: 'msg_document',
          },
          pushName: 'Alice',
          message: {
            documentMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7119-24/report.pdf',
              fileName: 'report.pdf',
              mimetype: 'application/pdf',
              fileLength: 24680,
            },
          },
          messageType: 'documentMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '8619917902815',
        text: '',
        attachments: [
          expect.objectContaining({
            url: 'https://mmg.whatsapp.net/v/t62.7119-24/report.pdf',
            filename: 'report.pdf',
            contentType: 'application/pdf',
            size: 24680,
          }),
        ],
        attachmentPolicy: { allowDataUrls: false },
      }),
    );
  });

  it('does not route Evolution data URL media attachments', async () => {
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
            id: 'msg_data_url',
          },
          pushName: 'Alice',
          message: {
            imageMessage: {
              url: 'data:image/png;base64,cG5n',
              mimetype: 'image/png',
            },
          },
          messageType: 'imageMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('does not route Evolution data URL media attachments with captions as text-only input', async () => {
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
            id: 'msg_data_url_caption',
          },
          pushName: 'Alice',
          message: {
            imageMessage: {
              url: 'data:image/png;base64,cG5n',
              caption: 'unsafe inline image',
              mimetype: 'image/png',
            },
          },
          messageType: 'imageMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('does not route Evolution control-prefixed data URL media with captions as text-only input', async () => {
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
            id: 'msg_control_data_url_caption',
          },
          pushName: 'Alice',
          message: {
            imageMessage: {
              url: '\u0000data:image/png;base64,cG5n',
              caption: 'unsafe inline image',
              mimetype: 'image/png',
            },
          },
          messageType: 'imageMessage',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(routeInboundMessage).not.toHaveBeenCalled();
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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
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

  it('returns a retryable error when receipt persistence fails before routing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.inboundWebhookReceipt.create.mockRejectedValueOnce(new Error('database unavailable'));

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
          msgId: 'msg_receipt_error',
        },
      }),
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'receipt_persist_failed' });
    expect(routeInboundMessage).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
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

describe('gatewayRouter public generic route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose unauthenticated generic channel injection', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ch_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalId: 'attacker',
        displayName: 'Attacker',
        text: 'hello',
        meta: { platform: 'whatsapp_evolution' },
      }),
    });

    expect(res.status).toBe(404);
    expect(routeInboundMessage).not.toHaveBeenCalled();
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
