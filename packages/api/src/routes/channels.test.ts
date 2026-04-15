import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_COKE_AGENT_ID } from '../lib/platformization-migration.js';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  agentFindFirst: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  generateId: vi.fn(() => 'ch_new'),
  startWeixinQR: vi.fn(),
  stopWeixinBot: vi.fn(),
  getWeixinQR: vi.fn(),
  getWeixinStatus: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    agent: {
      findFirst: mocks.agentFindFirst,
    },
    channel: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      create: mocks.create,
      delete: mocks.delete,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

vi.mock('../lib/id.js', () => ({
  generateId: mocks.generateId,
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('auth', { userId: 'usr_1', tenantId: 'tnt_1', role: 'admin' });
    await next();
  },
  requireAdmin: async (_c: any, next: any) => {
    await next();
  },
}));

vi.mock('../adapters/wechat.js', () => ({
  startWeixinBot: vi.fn(),
  startWeixinQR: mocks.startWeixinQR,
  stopWeixinBot: mocks.stopWeixinBot,
  getWeixinQR: mocks.getWeixinQR,
  getWeixinStatus: mocks.getWeixinStatus,
}));

vi.mock('../adapters/whatsapp.js', () => ({
  startWhatsAppBot: vi.fn(),
  stopWhatsAppBot: vi.fn(),
  getWhatsAppQR: vi.fn(),
  getWhatsAppStatus: vi.fn(),
}));

vi.mock('../adapters/discord.js', () => ({
  startDiscordBot: vi.fn(),
  stopDiscordBot: vi.fn(),
}));

vi.mock('../adapters/wecom.js', () => ({
  startWeChatBot: vi.fn(),
  stopWeChatBot: vi.fn(),
}));

vi.mock('../adapters/whatsapp-business.js', () => ({
  startWABusinessBot: vi.fn(),
  stopWABusinessBot: vi.fn(),
  reloadWABusinessBot: vi.fn(),
}));

vi.mock('../adapters/telegram.js', () => ({
  startTelegramBot: vi.fn(),
  stopTelegramBot: vi.fn(),
}));

vi.mock('../adapters/slack.js', () => ({
  startSlackBot: vi.fn(),
  stopSlackBot: vi.fn(),
}));

vi.mock('../adapters/matrix.js', () => ({
  startMatrixBot: vi.fn(),
  stopMatrixBot: vi.fn(),
}));

vi.mock('../adapters/line.js', () => ({
  startLineBot: vi.fn(),
  stopLineBot: vi.fn(),
}));

vi.mock('../adapters/signal.js', () => ({
  startSignalBot: vi.fn(),
  stopSignalBot: vi.fn(),
}));

vi.mock('../adapters/teams.js', () => ({
  startTeamsBot: vi.fn(),
  stopTeamsBot: vi.fn(),
}));

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
}));

import { channelsRouter } from './channels.js';

describe('channels router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startWeixinQR.mockResolvedValue(undefined);
    mocks.stopWeixinBot.mockResolvedValue(undefined);
  });

  it('lists existing legacy wechat personal channels', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'ch_legacy',
        tenantId: 'tnt_1',
        type: 'wechat_personal',
        name: 'Legacy WeChat',
        status: 'connected',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels', {
      method: 'GET',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: [
        {
          id: 'ch_legacy',
          type: 'wechat_personal',
          name: 'Legacy WeChat',
          status: 'connected',
        },
      ],
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tnt_1',
      },
      select: expect.any(Object),
    });
  });

  it('rejects generic admin creation of shared wechat personal channels', async () => {
    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'wechat_personal',
        name: 'Shared WeChat',
        config: {},
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: 'wechat_personal channels can only be managed through existing legacy rows',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates generic admin channels with dormant shared ownership metadata', async () => {
    mocks.create.mockResolvedValueOnce({
      id: 'ch_new',
      tenantId: 'tnt_1',
      type: 'whatsapp',
      name: 'Shared WhatsApp',
      status: 'disconnected',
    });
    mocks.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      tenantId: 'tnt_1',
      type: 'whatsapp',
      name: 'Shared WhatsApp',
      status: 'disconnected',
    });

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'whatsapp',
        name: 'Shared WhatsApp',
        config: { phoneNumber: '+15551234567' },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'ch_1',
        type: 'whatsapp',
        name: 'Shared WhatsApp',
        status: 'disconnected',
      },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'ch_new',
        tenantId: 'tnt_1',
        type: 'whatsapp',
        name: 'Shared WhatsApp',
        config: { phoneNumber: '+15551234567' },
        status: 'disconnected',
        ownershipKind: 'shared',
        agentId: DEFAULT_COKE_AGENT_ID,
        customerId: null,
      }),
    });
  });

  it('connects an existing legacy wechat personal channel', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'tnt_1',
      type: 'wechat_personal',
      status: 'disconnected',
      config: {},
    });
    mocks.update.mockResolvedValue({});
    mocks.getWeixinQR.mockReturnValue(null);
    mocks.getWeixinStatus.mockReturnValue(null);

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels/ch_1/connect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: { status: 'pending' },
    });
    expect(mocks.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'ch_1' },
      data: { status: 'connected' },
    });
    expect(mocks.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'ch_1' },
      data: { status: 'pending' },
    });
    expect(mocks.startWeixinQR).toHaveBeenCalledWith('ch_1');
  });

  it('does not reconnect archived wechat personal channels', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'ch_archived',
      tenantId: 'tnt_1',
      type: 'wechat_personal',
      status: 'archived',
      config: {},
    });

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels/ch_archived/connect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: 'archived_channel',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.startWeixinQR).not.toHaveBeenCalled();
  });

  it('disconnects an existing legacy wechat personal channel', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'ch_2',
      tenantId: 'tnt_1',
      type: 'wechat_personal',
      status: 'connected',
      config: {},
    });
    mocks.update.mockResolvedValue({});

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels/ch_2/disconnect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: { status: 'disconnected' },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'ch_2' },
      data: { status: 'disconnected' },
    });
    expect(mocks.stopWeixinBot).toHaveBeenCalledWith('ch_2');
  });

  it('does not disconnect archived wechat personal channels', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'ch_archived',
      tenantId: 'tnt_1',
      type: 'wechat_personal',
      status: 'archived',
      config: {},
    });

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels/ch_archived/disconnect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: 'archived_channel',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.stopWeixinBot).not.toHaveBeenCalled();
  });

  it('archives legacy wechat personal channels instead of hard deleting them', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'ch_legacy',
      tenantId: 'tnt_1',
      type: 'wechat_personal',
      status: 'disconnected',
      config: { token: 'legacy' },
    });
    mocks.update.mockResolvedValue({
      id: 'ch_legacy',
      status: 'archived',
    });

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels/ch_legacy', {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: null,
    });
    expect(mocks.stopWeixinBot).toHaveBeenCalledWith('ch_legacy');
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'ch_legacy' },
      data: {
        status: 'archived',
        config: {},
        activeLifecycleKey: null,
      },
    });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('refuses to archive live legacy wechat personal channels from the admin route', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'ch_live',
      tenantId: 'tnt_1',
      type: 'wechat_personal',
      status: 'connected',
      config: {},
    });
    mocks.getWeixinStatus.mockReturnValue('connected');

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels/ch_live', {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: 'disconnect_before_archive',
    });
    expect(mocks.stopWeixinBot).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('restarts pending wechat personal qr flow when in-memory state is missing', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'ch_1',
      type: 'wechat_personal',
      status: 'pending',
    });
    mocks.getWeixinQR.mockReturnValue(null);
    mocks.getWeixinStatus.mockReturnValue(null);

    const app = new Hono();
    app.route('/api/channels', channelsRouter);

    const res = await app.request('/api/channels/ch_1/qr', {
      method: 'GET',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.startWeixinQR).toHaveBeenCalledWith('ch_1');
    expect(body).toMatchObject({
      ok: true,
      data: {
        qr: null,
        qrUrl: null,
      },
    });
  });
});
