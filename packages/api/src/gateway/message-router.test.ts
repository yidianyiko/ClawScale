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
