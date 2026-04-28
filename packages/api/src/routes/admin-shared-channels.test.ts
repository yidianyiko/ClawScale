import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  channel: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const setWebhook = vi.hoisted(() => vi.fn());
const clearWebhook = vi.hoisted(() => vi.fn());
const createWebhookSubscription = vi.hoisted(() => vi.fn());
const deleteWebhookSubscription = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (_c: any, next: any) => {
    await next();
  },
}));
vi.mock('../lib/evolution-api.js', () => ({
  EvolutionApiClient: vi.fn().mockImplementation(() => ({
    setWebhook,
    clearWebhook,
  })),
}));
vi.mock('../lib/linq-api.js', () => ({
  LinqApiClient: vi.fn().mockImplementation(() => ({
    createWebhookSubscription,
    deleteWebhookSubscription,
  })),
}));
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'token_uuid_1'),
}));

import { adminSharedChannelsRouter } from './admin-shared-channels.js';

describe('admin shared channels route', () => {
  const originalApiUrl = process.env['NEXT_PUBLIC_API_URL'];

  beforeEach(() => {
    vi.clearAllMocks();
    setWebhook.mockResolvedValue({ ok: true });
    clearWebhook.mockResolvedValue({ ok: true });
    createWebhookSubscription.mockResolvedValue({
      id: 'sub_1',
      signingSecret: 'signing-secret',
    });
    deleteWebhookSubscription.mockResolvedValue(null);
    process.env['NEXT_PUBLIC_API_URL'] = 'https://coke.keep4oforever.com';
  });

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env['NEXT_PUBLIC_API_URL'];
    } else {
      process.env['NEXT_PUBLIC_API_URL'] = originalApiUrl;
    }
  });

  it('lists shared channels with their configured agent and paging metadata', async () => {
    db.channel.findMany.mockResolvedValue([
      {
        id: 'ch_1',
        name: 'Primary WhatsApp',
        type: 'whatsapp',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      },
    ]);
    db.channel.count.mockResolvedValue(1);

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels?limit=20&offset=0');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        rows: [
          {
            id: 'ch_1',
            name: 'Primary WhatsApp',
            kind: 'whatsapp',
            status: 'connected',
            ownershipKind: 'shared',
            customerId: null,
            agent: {
              id: 'agent_coke',
              slug: 'coke',
              name: 'Coke',
            },
            createdAt: '2026-04-16T09:00:00.000Z',
            updatedAt: '2026-04-16T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      },
    });
  });

  it('lists malformed wechat_ecloud rows with safe config error metadata', async () => {
    db.channel.findMany.mockResolvedValue([
      {
        id: 'ch_ecloud_legacy',
        name: 'Legacy Ecloud WeChat',
        type: 'wechat_ecloud',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          token: 'token_1',
          baseUrl: 'https://api.geweapi.com',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      },
    ]);
    db.channel.count.mockResolvedValue(1);

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels?limit=20&offset=0');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        rows: [
          {
            id: 'ch_ecloud_legacy',
            kind: 'wechat_ecloud',
            hasWebhookToken: false,
            configError: 'invalid_wechat_ecloud_config',
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain('token_1');
  });

  it('returns shared channel details for the configuration page', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      name: 'Primary WhatsApp',
      type: 'whatsapp',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        accessToken: 'secret',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_1',
        name: 'Primary WhatsApp',
        kind: 'whatsapp',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          accessToken: 'secret',
        },
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    });
  });

  it('returns malformed wechat_ecloud detail with safe config error metadata', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_ecloud_legacy',
      name: 'Legacy Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        token: 'token_1',
        baseUrl: 'https://api.geweapi.com',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_ecloud_legacy');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'ch_ecloud_legacy',
        kind: 'wechat_ecloud',
        config: {},
        hasWebhookToken: false,
        configError: 'invalid_wechat_ecloud_config',
      },
    });
    expect(JSON.stringify(body)).not.toContain('token_1');
  });

  it('scrubs webhookToken from shared channel detail responses', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_1',
        name: 'Evolution WhatsApp',
        kind: 'whatsapp_evolution',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          instanceName: 'coke-whatsapp-personal',
        },
        hasWebhookToken: true,
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    });
  });

  it('keeps legacy whatsapp_evolution rows readable when webhookToken is missing', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_legacy',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_legacy');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_legacy',
        name: 'Evolution WhatsApp',
        kind: 'whatsapp_evolution',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          instanceName: 'coke-whatsapp-personal',
        },
        hasWebhookToken: false,
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    });
  });

  it('scrubs linq secrets from shared channel detail responses', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_linq',
        name: 'Linq Shared',
        kind: 'linq',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          fromNumber: '+13213108456',
          webhookSubscriptionId: 'sub_1',
        },
        hasWebhookToken: true,
        hasSigningSecret: true,
        createdAt: '2026-04-28T11:30:00.000Z',
        updatedAt: '2026-04-28T11:40:00.000Z',
      },
    });
  });

  it('hides retired shared channels from the detail route', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      name: 'Primary WhatsApp',
      type: 'whatsapp',
      status: 'archived',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {},
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'shared_channel_not_found' });
  });

  it('rejects retired generic shared channel kinds', async () => {
    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'whatsapp',
        name: 'Primary WhatsApp',
        agentId: 'agent_coke',
        config: {
          accessToken: 'secret',
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: 'validation_error',
    });
    expect(db.channel.create).not.toHaveBeenCalled();
  });

  it('accepts whatsapp_evolution shared channels', async () => {
    db.channel.create.mockResolvedValueOnce({
      id: 'ch_new',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'token_uuid_1',
      },
      createdAt: new Date('2026-04-16T11:30:00.000Z'),
      updatedAt: new Date('2026-04-16T11:30:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'whatsapp_evolution',
        name: 'Evolution WhatsApp',
        agentId: 'agent_coke',
        config: {
          instanceName: 'coke-whatsapp-personal',
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_new',
        name: 'Evolution WhatsApp',
        kind: 'whatsapp_evolution',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          instanceName: 'coke-whatsapp-personal',
        },
        hasWebhookToken: true,
        createdAt: '2026-04-16T11:30:00.000Z',
        updatedAt: '2026-04-16T11:30:00.000Z',
      },
    });
    expect(db.channel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'whatsapp_evolution',
        name: 'Evolution WhatsApp',
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'token_uuid_1',
        },
      }),
      select: expect.any(Object),
    });
  });

  it('creates wechat_ecloud shared channels with scrubbed public config and generated webhook tokens', async () => {
    db.channel.create.mockResolvedValueOnce({
      id: 'ch_ecloud',
      name: 'Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        appId: 'app_1',
        token: 'token_1',
        baseUrl: 'https://api.geweapi.com',
        webhookToken: 'token_uuid_1',
      },
      createdAt: new Date('2026-04-16T11:45:00.000Z'),
      updatedAt: new Date('2026-04-16T11:45:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'wechat_ecloud',
        name: 'Ecloud WeChat',
        agentId: 'agent_coke',
        config: {
          appId: 'app_1',
          token: 'token_1',
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_ecloud',
        name: 'Ecloud WeChat',
        kind: 'wechat_ecloud',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          appId: 'app_1',
          baseUrl: 'https://api.geweapi.com',
          callbackPath: '/gateway/ecloud/wechat/:channelId/:token',
        },
        hasWebhookToken: true,
        createdAt: '2026-04-16T11:45:00.000Z',
        updatedAt: '2026-04-16T11:45:00.000Z',
      },
    });
    expect(JSON.stringify(body)).not.toContain('token_1');
    expect(JSON.stringify(body)).not.toContain('token_uuid_1');
    expect(db.channel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'wechat_ecloud',
        status: 'disconnected',
        config: {
          appId: 'app_1',
          token: 'token_1',
          baseUrl: 'https://api.geweapi.com',
          webhookToken: 'token_uuid_1',
        },
      }),
      select: expect.any(Object),
    });
  });

  it('creates linq shared channels with fromNumber and hidden secrets', async () => {
    db.channel.create.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'token_uuid_1',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:30:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'linq',
        name: 'Linq Shared',
        agentId: 'agent_coke',
        config: {
          fromNumber: '+1 (321) 310-8456',
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_linq',
        name: 'Linq Shared',
        kind: 'linq',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          fromNumber: '+13213108456',
        },
        hasWebhookToken: true,
        hasSigningSecret: false,
        createdAt: '2026-04-28T11:30:00.000Z',
        updatedAt: '2026-04-28T11:30:00.000Z',
      },
    });
    expect(db.channel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'linq',
        name: 'Linq Shared',
        config: {
          fromNumber: '+13213108456',
          webhookToken: 'token_uuid_1',
        },
      }),
      select: expect.any(Object),
    });
  });

  it('serializes wechat_ecloud details without exposing token or webhookToken', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_ecloud',
      name: 'Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        appId: 'app_1',
        token: 'token_1',
        baseUrl: 'https://api.example.test',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_ecloud');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'ch_ecloud',
        kind: 'wechat_ecloud',
        config: {
          appId: 'app_1',
          baseUrl: 'https://api.example.test',
          callbackPath: '/gateway/ecloud/wechat/:channelId/:token',
        },
        hasWebhookToken: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain('token_1');
    expect(JSON.stringify(body)).not.toContain('secret-token');
  });

  it('updates shared channel configuration without changing shared ownership', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Primary WhatsApp',
      type: 'whatsapp',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        accessToken: 'secret',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Primary WhatsApp',
      type: 'whatsapp',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_2',
      config: {
        accessToken: 'updated',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T12:00:00.000Z'),
      agent: {
        id: 'agent_2',
        slug: 'other',
        name: 'Other agent',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Primary WhatsApp',
        agentId: 'agent_2',
        config: {
          accessToken: 'updated',
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_1',
        name: 'Primary WhatsApp',
        kind: 'whatsapp',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_2',
          slug: 'other',
          name: 'Other agent',
        },
        config: {
          accessToken: 'updated',
        },
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T12:00:00.000Z',
      },
    });
  });

  it('rejects webhookToken patch attempts for whatsapp_evolution channels', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'new-secret',
        },
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'webhook_token_not_mutable' });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('refuses instanceName changes while a whatsapp_evolution channel is connected', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          instanceName: 'different-instance',
        },
      }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'disconnect_before_instance_change' });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('rejects wechat_ecloud token and webhookToken patch attempts', async () => {
    const row = {
      id: 'ch_ecloud',
      name: 'Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        appId: 'app_1',
        token: 'token_1',
        baseUrl: 'https://api.geweapi.com',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    };
    db.channel.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row);

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const tokenRes = await app.request('/api/admin/shared-channels/ch_ecloud', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          appId: 'app_1',
          token: 'token_2',
          baseUrl: 'https://api.geweapi.com',
        },
      }),
    });
    const webhookTokenRes = await app.request('/api/admin/shared-channels/ch_ecloud', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          appId: 'app_1',
          baseUrl: 'https://api.geweapi.com',
          webhookToken: 'new-secret',
        },
      }),
    });

    expect(tokenRes.status).toBe(400);
    await expect(tokenRes.json()).resolves.toEqual({ ok: false, error: 'token_not_mutable' });
    expect(webhookTokenRes.status).toBe(400);
    await expect(webhookTokenRes.json()).resolves.toEqual({ ok: false, error: 'webhook_token_not_mutable' });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('rejects linq secret patch attempts and connected fromNumber changes', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const secretRes = await app.request('/api/admin/shared-channels/ch_linq', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { fromNumber: '+13213108456', signingSecret: 'new' } }),
    });
    expect(secretRes.status).toBe(400);
    await expect(secretRes.json()).resolves.toEqual({ ok: false, error: 'linq_secret_not_mutable' });

    const numberRes = await app.request('/api/admin/shared-channels/ch_linq', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { fromNumber: '+14155550100' } }),
    });
    expect(numberRes.status).toBe(409);
    await expect(numberRes.json()).resolves.toEqual({
      ok: false,
      error: 'linq_from_number_not_mutable_while_connected',
    });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('updates wechat_ecloud public config while disconnected and refuses config changes while connected', async () => {
    db.channel.findUnique
      .mockResolvedValueOnce({
        id: 'ch_ecloud',
        name: 'Ecloud WeChat',
        type: 'wechat_ecloud',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          appId: 'app_1',
          token: 'token_1',
          baseUrl: 'https://api.geweapi.com',
          webhookToken: 'secret-token',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      })
      .mockResolvedValueOnce({
        id: 'ch_ecloud',
        name: 'Ecloud WeChat',
        type: 'wechat_ecloud',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          appId: 'app_2',
          token: 'token_1',
          baseUrl: 'https://api.example.test',
          webhookToken: 'secret-token',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_ecloud',
      name: 'Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        appId: 'app_2',
        token: 'token_1',
        baseUrl: 'https://api.example.test',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T12:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const updateRes = await app.request('/api/admin/shared-channels/ch_ecloud', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          appId: 'app_2',
          baseUrl: 'https://api.example.test',
        },
      }),
    });
    const updateBody = await updateRes.json();

    expect(updateRes.status).toBe(200);
    expect(updateBody.data.config).toEqual({
      appId: 'app_2',
      baseUrl: 'https://api.example.test',
      callbackPath: '/gateway/ecloud/wechat/:channelId/:token',
    });
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_ecloud' },
      data: {
        config: {
          appId: 'app_2',
          token: 'token_1',
          baseUrl: 'https://api.example.test',
          webhookToken: 'secret-token',
        },
      },
      select: expect.any(Object),
    });

    const connectedRes = await app.request('/api/admin/shared-channels/ch_ecloud', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          appId: 'app_3',
          baseUrl: 'https://api.other.test',
        },
      }),
    });

    expect(connectedRes.status).toBe(409);
    await expect(connectedRes.json()).resolves.toEqual({
      ok: false,
      error: 'disconnect_before_config_change',
    });
  });

  it('returns controlled error when patching malformed legacy wechat_ecloud config', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_ecloud_legacy',
      name: 'Legacy Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        appId: 'app_1',
        token: 'token_1',
        baseUrl: 'https://api.geweapi.com',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_ecloud_legacy', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          appId: 'app_2',
          baseUrl: 'https://api.example.test',
        },
      }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_wechat_ecloud_config:webhookToken',
    });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('returns controlled error for metadata-only patch on malformed legacy wechat_ecloud config', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_ecloud_legacy',
      name: 'Legacy Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        baseUrl: 'https://api.geweapi.com',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_ecloud_legacy', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Renamed Ecloud WeChat',
      }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_wechat_ecloud_config:appId',
    });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('connects a whatsapp_evolution shared channel by registering an Evolution webhook', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1/connect', {
      method: 'POST',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'ch_1',
        kind: 'whatsapp_evolution',
        status: 'connected',
        config: {
          instanceName: 'coke-whatsapp-personal',
        },
        hasWebhookToken: true,
      },
    });
    expect(setWebhook).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      'https://coke.keep4oforever.com/gateway/evolution/whatsapp/ch_1/secret-token',
    );
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: { status: 'connected' },
      select: expect.any(Object),
    });
  });

  it('backfills a missing webhook token before connecting legacy whatsapp_evolution channels', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_legacy',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update
      .mockResolvedValueOnce({
        id: 'ch_legacy',
        name: 'Evolution WhatsApp',
        type: 'whatsapp_evolution',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'token_uuid_1',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      })
      .mockResolvedValueOnce({
        id: 'ch_legacy',
        name: 'Evolution WhatsApp',
        type: 'whatsapp_evolution',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'token_uuid_1',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_legacy/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(db.channel.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'ch_legacy' },
      data: {
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'token_uuid_1',
        },
      },
      select: expect.any(Object),
    });
    expect(setWebhook).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      'https://coke.keep4oforever.com/gateway/evolution/whatsapp/ch_legacy/token_uuid_1',
    );
    expect(db.channel.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'ch_legacy' },
      data: { status: 'connected' },
      select: expect.any(Object),
    });
  });

  it('rolls back remote webhook registration when local connect state write fails', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockRejectedValueOnce(new Error('db down'));

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(500);
    expect(setWebhook).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      'https://coke.keep4oforever.com/gateway/evolution/whatsapp/ch_1/secret-token',
    );
    expect(clearWebhook).toHaveBeenCalledWith('coke-whatsapp-personal');
  });

  it('connects linq shared channels by creating a webhook subscription', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: { fromNumber: '+13213108456', webhookToken: 'secret-token' },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq/connect', { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'ch_linq',
        kind: 'linq',
        status: 'connected',
        config: {
          fromNumber: '+13213108456',
          webhookSubscriptionId: 'sub_1',
        },
        hasWebhookToken: true,
        hasSigningSecret: true,
      },
    });
    expect(createWebhookSubscription).toHaveBeenCalledWith({
      targetUrl: 'https://coke.keep4oforever.com/gateway/linq/ch_linq/secret-token',
      phoneNumbers: ['+13213108456'],
    });
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_linq' },
      data: {
        status: 'connected',
        config: {
          fromNumber: '+13213108456',
          webhookToken: 'secret-token',
          webhookSubscriptionId: 'sub_1',
          signingSecret: 'signing-secret',
        },
      },
      select: expect.any(Object),
    });
  });

  it('rolls back linq webhook registration when local connect state write fails', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: { fromNumber: '+13213108456', webhookToken: 'secret-token' },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });
    db.channel.update.mockRejectedValueOnce(new Error('db down'));

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq/connect', { method: 'POST' });

    expect(res.status).toBe(500);
    expect(createWebhookSubscription).toHaveBeenCalledWith({
      targetUrl: 'https://coke.keep4oforever.com/gateway/linq/ch_linq/secret-token',
      phoneNumbers: ['+13213108456'],
    });
    expect(deleteWebhookSubscription).toHaveBeenCalledWith('sub_1');
  });

  it('returns 502 when linq webhook subscription creation fails', async () => {
    createWebhookSubscription.mockRejectedValueOnce(new Error('linq down'));
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: { fromNumber: '+13213108456', webhookToken: 'secret-token' },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq/connect', { method: 'POST' });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'linq_webhook_register_failed' });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('disconnects a whatsapp_evolution shared channel by clearing the Evolution webhook', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1/disconnect', {
      method: 'POST',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'ch_1',
        kind: 'whatsapp_evolution',
        status: 'disconnected',
      },
    });
    expect(clearWebhook).toHaveBeenCalledWith('coke-whatsapp-personal');
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: { status: 'disconnected' },
      select: expect.any(Object),
    });
  });

  it('connects and disconnects wechat_ecloud shared channels with local status updates only', async () => {
    db.channel.findUnique
      .mockResolvedValueOnce({
        id: 'ch_ecloud',
        name: 'Ecloud WeChat',
        type: 'wechat_ecloud',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          appId: 'app_1',
          token: 'token_1',
          baseUrl: 'https://api.geweapi.com',
          webhookToken: 'secret-token',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      })
      .mockResolvedValueOnce({
        id: 'ch_ecloud',
        name: 'Ecloud WeChat',
        type: 'wechat_ecloud',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          appId: 'app_1',
          token: 'token_1',
          baseUrl: 'https://api.geweapi.com',
          webhookToken: 'secret-token',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      });
    db.channel.update
      .mockResolvedValueOnce({
        id: 'ch_ecloud',
        name: 'Ecloud WeChat',
        type: 'wechat_ecloud',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          appId: 'app_1',
          token: 'token_1',
          baseUrl: 'https://api.geweapi.com',
          webhookToken: 'secret-token',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:30:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      })
      .mockResolvedValueOnce({
        id: 'ch_ecloud',
        name: 'Ecloud WeChat',
        type: 'wechat_ecloud',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agentId: 'agent_coke',
        config: {
          appId: 'app_1',
          token: 'token_1',
          baseUrl: 'https://api.geweapi.com',
          webhookToken: 'secret-token',
        },
        createdAt: new Date('2026-04-16T09:00:00.000Z'),
        updatedAt: new Date('2026-04-16T11:00:00.000Z'),
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
      });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const connectRes = await app.request('/api/admin/shared-channels/ch_ecloud/connect', {
      method: 'POST',
    });
    const disconnectRes = await app.request('/api/admin/shared-channels/ch_ecloud/disconnect', {
      method: 'POST',
    });

    expect(connectRes.status).toBe(200);
    await expect(connectRes.json()).resolves.toMatchObject({
      ok: true,
      data: {
        kind: 'wechat_ecloud',
        status: 'connected',
        hasWebhookToken: true,
      },
    });
    expect(disconnectRes.status).toBe(200);
    await expect(disconnectRes.json()).resolves.toMatchObject({
      ok: true,
      data: {
        kind: 'wechat_ecloud',
        status: 'disconnected',
        hasWebhookToken: true,
      },
    });
    expect(setWebhook).not.toHaveBeenCalled();
    expect(clearWebhook).not.toHaveBeenCalled();
    expect(db.channel.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'ch_ecloud' },
      data: { status: 'connected' },
      select: expect.any(Object),
    });
    expect(db.channel.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'ch_ecloud' },
      data: { status: 'disconnected' },
      select: expect.any(Object),
    });
  });

  it('rejects legacy wechat_ecloud connect without webhookToken instead of mutating config', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_ecloud_legacy',
      name: 'Legacy Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        appId: 'app_1',
        token: 'token_1',
        baseUrl: 'https://api.geweapi.com',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_ecloud_legacy/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_wechat_ecloud_config:webhookToken',
    });
    expect(db.channel.update).not.toHaveBeenCalled();
    expect(setWebhook).not.toHaveBeenCalled();
    expect(clearWebhook).not.toHaveBeenCalled();
  });

  it('restores the remote webhook when local disconnect state write fails', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockRejectedValueOnce(new Error('db down'));

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1/disconnect', {
      method: 'POST',
    });

    expect(res.status).toBe(500);
    expect(clearWebhook).toHaveBeenCalledWith('coke-whatsapp-personal');
    expect(setWebhook).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      'https://coke.keep4oforever.com/gateway/evolution/whatsapp/ch_1/secret-token',
    );
  });

  it('disconnects linq shared channels by deleting the webhook subscription and clearing remote secrets', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: { fromNumber: '+13213108456', webhookToken: 'secret-token' },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq/disconnect', { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        id: 'ch_linq',
        kind: 'linq',
        status: 'disconnected',
        config: { fromNumber: '+13213108456' },
        hasWebhookToken: true,
        hasSigningSecret: false,
      },
    });
    expect(deleteWebhookSubscription).toHaveBeenCalledWith('sub_1');
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_linq' },
      data: {
        status: 'disconnected',
        config: { fromNumber: '+13213108456', webhookToken: 'secret-token' },
      },
      select: expect.any(Object),
    });
  });

  it('recreates linq webhook subscription and persists fresh rollback secrets when local disconnect state write fails', async () => {
    createWebhookSubscription.mockResolvedValueOnce({
      id: 'sub_rollback',
      signingSecret: 'rollback-signing-secret',
    });
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });
    db.channel.update.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({});

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq/disconnect', { method: 'POST' });

    expect(res.status).toBe(500);
    expect(deleteWebhookSubscription).toHaveBeenCalledWith('sub_1');
    expect(createWebhookSubscription).toHaveBeenCalledWith({
      targetUrl: 'https://coke.keep4oforever.com/gateway/linq/ch_linq/secret-token',
      phoneNumbers: ['+13213108456'],
    });
    expect(db.channel.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'ch_linq' },
      data: {
        status: 'connected',
        config: {
          fromNumber: '+13213108456',
          webhookToken: 'secret-token',
          webhookSubscriptionId: 'sub_rollback',
          signingSecret: 'rollback-signing-secret',
        },
      },
      select: expect.any(Object),
    });
  });

  it('returns 502 when linq webhook subscription deletion fails during disconnect', async () => {
    deleteWebhookSubscription.mockRejectedValueOnce(new Error('linq down'));
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq/disconnect', { method: 'POST' });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'linq_webhook_delete_failed' });
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('restores the remote webhook when archive fails after clearing it', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockRejectedValueOnce(new Error('db down'));

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(500);
    expect(clearWebhook).toHaveBeenCalledWith('coke-whatsapp-personal');
    expect(setWebhook).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      'https://coke.keep4oforever.com/gateway/evolution/whatsapp/ch_1/secret-token',
    );
  });

  it('retires shared channels by archiving them in place', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Primary WhatsApp',
      type: 'whatsapp',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        accessToken: 'secret',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'archived',
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1', {
      method: 'DELETE',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: null,
    });
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: {
        status: 'archived',
        config: {},
      },
    });
  });

  it('retires wechat_ecloud shared channels without remote calls and clears config', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_ecloud',
      name: 'Ecloud WeChat',
      type: 'wechat_ecloud',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        appId: 'app_1',
        token: 'token_1',
        baseUrl: 'https://api.geweapi.com',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_ecloud',
      status: 'archived',
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_ecloud', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, data: null });
    expect(setWebhook).not.toHaveBeenCalled();
    expect(clearWebhook).not.toHaveBeenCalled();
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_ecloud' },
      data: {
        status: 'archived',
        config: {},
      },
    });
  });

  it('retires connected linq shared channels by deleting the webhook subscription and clearing remote secrets', async () => {
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_linq',
      status: 'archived',
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq', { method: 'DELETE' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, data: null });
    expect(deleteWebhookSubscription).toHaveBeenCalledWith('sub_1');
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_linq' },
      data: {
        status: 'archived',
        config: { fromNumber: '+13213108456', webhookToken: 'secret-token' },
      },
    });
  });

  it('recreates linq webhook subscription and persists fresh rollback secrets when archive state write fails', async () => {
    db.channel.update.mockReset();
    createWebhookSubscription.mockResolvedValueOnce({
      id: 'sub_rollback',
      signingSecret: 'rollback-signing-secret',
    });
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_linq',
      name: 'Linq Shared',
      type: 'linq',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        fromNumber: '+13213108456',
        webhookToken: 'secret-token',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'signing-secret',
      },
      createdAt: new Date('2026-04-28T11:30:00.000Z'),
      updatedAt: new Date('2026-04-28T11:40:00.000Z'),
      agent: { id: 'agent_coke', slug: 'coke', name: 'Coke' },
    });
    db.channel.update.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({});

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_linq', { method: 'DELETE' });

    expect(res.status).toBe(500);
    expect(deleteWebhookSubscription).toHaveBeenCalledWith('sub_1');
    expect(createWebhookSubscription).toHaveBeenCalledWith({
      targetUrl: 'https://coke.keep4oforever.com/gateway/linq/ch_linq/secret-token',
      phoneNumbers: ['+13213108456'],
    });
    expect(db.channel.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'ch_linq' },
      data: {
        status: 'connected',
        config: {
          fromNumber: '+13213108456',
          webhookToken: 'secret-token',
          webhookSubscriptionId: 'sub_rollback',
          signingSecret: 'rollback-signing-secret',
        },
      },
      select: expect.any(Object),
    });
  });

  it('refuses to retire a connected channel when remote webhook clear fails', async () => {
    clearWebhook.mockRejectedValueOnce(new Error('gateway down'));
    db.channel.findUnique.mockResolvedValueOnce({
      id: 'ch_1',
      name: 'Evolution WhatsApp',
      type: 'whatsapp_evolution',
      status: 'connected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal',
        webhookToken: 'secret-token',
      },
      createdAt: new Date('2026-04-16T09:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
      agent: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
      },
    });

    const app = new Hono();
    app.route('/api/admin/shared-channels', adminSharedChannelsRouter);

    const res = await app.request('/api/admin/shared-channels/ch_1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'evolution_webhook_clear_failed' });
    expect(db.channel.update).not.toHaveBeenCalled();
  });
});
