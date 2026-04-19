import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../db/index.js', () => ({ db }));

vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (_c: any, next: any) => {
    await next();
  },
}));

import { adminSharedChannelsRouter } from './admin-shared-channels.js';

describe('admin shared channels route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(db.channel.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      select: expect.any(Object),
      skip: 0,
      take: 20,
      where: {
        ownershipKind: 'shared',
        status: {
          not: 'archived',
        },
      },
    });
    expect(db.channel.count).toHaveBeenCalledWith({
      where: {
        ownershipKind: 'shared',
        status: {
          not: 'archived',
        },
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
    expect(db.channel.findUnique).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      select: expect.any(Object),
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
    expect(db.channel.create).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^ch_/),
        tenant: { connect: { id: 'ten_1' } },
        name: 'Primary WhatsApp',
        type: 'whatsapp',
        sharedAgent: { connect: { id: 'agent_coke' } },
        config: {
          accessToken: 'secret',
        },
        status: 'disconnected',
        ownershipKind: 'shared',
      },
      select: expect.any(Object),
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
      config: {},
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
        config: {},
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
        config: {},
        createdAt: '2026-04-16T11:30:00.000Z',
        updatedAt: '2026-04-16T11:30:00.000Z',
      },
    });
    expect(db.channel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'whatsapp_evolution',
        name: 'Evolution WhatsApp',
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
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: {
        name: 'Primary WhatsApp',
        sharedAgent: { connect: { id: 'agent_2' } },
        config: {
          accessToken: 'updated',
        },
      },
      select: expect.any(Object),
    });
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
});
