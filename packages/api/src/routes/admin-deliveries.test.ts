import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  outboundDelivery: {
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

import { adminDeliveriesRouter } from './admin-deliveries.js';

describe('admin deliveries route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns recent failed outbound deliveries ordered by failure recency', async () => {
    db.outboundDelivery.findMany.mockResolvedValue([
      {
        id: 'out_1',
        tenantId: 'tnt_1',
        channelId: 'ch_1',
        idempotencyKey: 'idem_1',
        status: 'failed',
        error: 'channel unreachable',
        createdAt: new Date('2026-04-10T10:00:00.000Z'),
        updatedAt: new Date('2026-04-10T10:05:00.000Z'),
      },
    ]);
    db.outboundDelivery.count.mockResolvedValue(1);

    const app = new Hono();
    app.route('/api/admin/deliveries', adminDeliveriesRouter);

    const res = await app.request('/api/admin/deliveries?limit=25&offset=0');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        rows: [
          {
            id: 'out_1',
            tenantId: 'tnt_1',
            channelId: 'ch_1',
            idempotencyKey: 'idem_1',
            status: 'failed',
            error: 'channel unreachable',
            createdAt: '2026-04-10T10:00:00.000Z',
            updatedAt: '2026-04-10T10:05:00.000Z',
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
    });
    expect(db.outboundDelivery.findMany).toHaveBeenCalledWith({
      orderBy: { updatedAt: 'desc' },
      select: expect.any(Object),
      skip: 0,
      take: 25,
      where: {
        status: 'failed',
      },
    });
    expect(db.outboundDelivery.count).toHaveBeenCalledWith({
      where: {
        status: 'failed',
      },
    });
  });

  it('rejects malformed paging params', async () => {
    const app = new Hono();
    app.route('/api/admin/deliveries', adminDeliveriesRouter);

    const res = await app.request('/api/admin/deliveries?limit=25&offset=sideways');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'validation_error',
      issues: expect.any(Array),
    });
    expect(db.outboundDelivery.findMany).not.toHaveBeenCalled();
    expect(db.outboundDelivery.count).not.toHaveBeenCalled();
  });
});
