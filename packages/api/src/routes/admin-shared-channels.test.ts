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

  it('creates a shared channel with dormant shared ownership metadata', async () => {
    db.channel.create.mockResolvedValueOnce({
      id: 'ch_new',
      name: 'Primary WhatsApp',
      type: 'whatsapp',
      status: 'disconnected',
      ownershipKind: 'shared',
      customerId: null,
      agentId: 'agent_coke',
      config: {
        accessToken: 'secret',
      },
      createdAt: new Date('2026-04-16T11:00:00.000Z'),
      updatedAt: new Date('2026-04-16T11:00:00.000Z'),
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
        kind: 'whatsapp',
        name: 'Primary WhatsApp',
        agentId: 'agent_coke',
        config: {
          accessToken: 'secret',
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'ch_new',
        name: 'Primary WhatsApp',
        kind: 'whatsapp',
        status: 'disconnected',
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
        createdAt: '2026-04-16T11:00:00.000Z',
        updatedAt: '2026-04-16T11:00:00.000Z',
      },
    });
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
