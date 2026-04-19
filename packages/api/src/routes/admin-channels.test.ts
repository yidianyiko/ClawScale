import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  channel: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (_c: any, next: any) => {
    await next();
  },
}));

import { adminChannelsRouter } from './admin-channels.js';

describe('admin channels route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters platform channels by status and kind with paging', async () => {
    db.channel.findMany.mockResolvedValue([
      {
        id: 'ch_1',
        name: 'Alice WhatsApp',
        type: 'whatsapp',
        status: 'connected',
        ownershipKind: 'customer',
        customerId: 'cust_123',
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-04-02T10:00:00.000Z'),
      },
    ]);
    db.channel.count.mockResolvedValue(1);

    const app = new Hono();
    app.route('/api/admin/channels', adminChannelsRouter);

    const res = await app.request('/api/admin/channels?status=connected&kind=whatsapp&limit=10&offset=20');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        rows: [
          {
            id: 'ch_1',
            name: 'Alice WhatsApp',
            kind: 'whatsapp',
            status: 'connected',
            ownershipKind: 'customer',
            customerId: 'cust_123',
            createdAt: '2026-04-01T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 10,
        offset: 20,
      },
    });
    expect(db.channel.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      select: expect.any(Object),
      skip: 20,
      take: 10,
      where: {
        ownershipKind: 'customer',
        status: 'connected',
        type: 'whatsapp',
      },
    });
    expect(db.channel.count).toHaveBeenCalledWith({
      where: {
        ownershipKind: 'customer',
        status: 'connected',
        type: 'whatsapp',
      },
    });
  });

  it('accepts whatsapp_evolution as a kind filter', async () => {
    db.channel.findMany.mockResolvedValue([]);
    db.channel.count.mockResolvedValue(0);

    const app = new Hono();
    app.route('/api/admin/channels', adminChannelsRouter);

    const res = await app.request('/api/admin/channels?kind=whatsapp_evolution');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        rows: [],
        total: 0,
        limit: 50,
        offset: 0,
      },
    });
    expect(db.channel.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      select: expect.any(Object),
      skip: 0,
      take: 50,
      where: {
        ownershipKind: 'customer',
        type: 'whatsapp_evolution',
      },
    });
    expect(db.channel.count).toHaveBeenCalledWith({
      where: {
        ownershipKind: 'customer',
        type: 'whatsapp_evolution',
      },
    });
  });

  it('rejects invalid status and kind filters', async () => {
    const app = new Hono();
    app.route('/api/admin/channels', adminChannelsRouter);

    const res = await app.request('/api/admin/channels?status=broken&kind=fax');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'validation_error',
      issues: expect.any(Array),
    });
    expect(db.channel.findMany).not.toHaveBeenCalled();
    expect(db.channel.count).not.toHaveBeenCalled();
  });

  it('rejects malformed paging params', async () => {
    const app = new Hono();
    app.route('/api/admin/channels', adminChannelsRouter);

    const res = await app.request('/api/admin/channels?limit=ten&offset=0');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'validation_error',
      issues: expect.any(Array),
    });
    expect(db.channel.findMany).not.toHaveBeenCalled();
    expect(db.channel.count).not.toHaveBeenCalled();
  });

  it('rejects unknown query params', async () => {
    const app = new Hono();
    app.route('/api/admin/channels', adminChannelsRouter);

    const res = await app.request('/api/admin/channels?statsu=connected');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'validation_error',
      issues: expect.any(Array),
    });
    expect(db.channel.findMany).not.toHaveBeenCalled();
    expect(db.channel.count).not.toHaveBeenCalled();
  });
});
