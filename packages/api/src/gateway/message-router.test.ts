import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

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

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/route-message.js', () => ({ routeInboundMessage }));
vi.mock('../lib/evolution-api.js', () => ({
  EvolutionApiClient: class {
    sendText = evolutionSendText;
  },
}));
vi.mock('../adapters/line.js', () => ({ getLineBot, handleLineEvents }));
vi.mock('../adapters/teams.js', () => ({ getTeamsBot, handleTeamsActivity }));
vi.mock('../adapters/whatsapp-business.js', () => ({
  verifyWebhook,
  handleWABusinessWebhook,
}));

import { gatewayRouter } from './message-router.js';

describe('gatewayRouter generic inbound route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeInboundMessage.mockResolvedValue({
      conversationId: 'conv_1',
      replies: [],
      reply: '',
    });
  });

  it('accepts attachment-only http requests', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ch_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalId: 'user_1',
        attachments: [{ url: 'https://cdn.example.com/photo.jpg', contentType: 'image/jpeg' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(routeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch_1',
        externalId: 'user_1',
        text: '',
        attachments: [
          expect.objectContaining({
            url: 'https://cdn.example.com/photo.jpg',
            contentType: 'image/jpeg',
          }),
        ],
        attachmentPolicy: { allowDataUrls: false },
      }),
    );
  });

  it('rejects data URLs before routing', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ch_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalId: 'user_1',
        text: 'caption',
        attachments: [{ url: 'data:image/png;base64,cG5n' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('rejects control-prefixed data URLs before routing', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ch_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalId: 'user_1',
        text: 'caption',
        attachments: [{ url: '\u0000data:image/png;base64,cG5n' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(routeInboundMessage).not.toHaveBeenCalled();
  });

  it('rejects empty messages without valid attachments', async () => {
    const app = new Hono();
    app.route('/gateway', gatewayRouter);

    const res = await app.request('/gateway/ch_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalId: 'user_1',
        text: '',
        attachments: [{ url: 'ftp://cdn.example.com/photo.jpg' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(routeInboundMessage).not.toHaveBeenCalled();
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
