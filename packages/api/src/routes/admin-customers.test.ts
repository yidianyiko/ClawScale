import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  customer: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  parkedInbound: {
    findMany: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (c: any, next: any) => {
    c.set('adminAuth', {
      adminId: 'adm_123',
      email: 'admin@example.com',
      isActive: true,
    });
    await next();
  },
}));

import { adminCustomersRouter } from './admin-customers.js';

describe('admin customers route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns contact identifier, claim status, lifecycle timestamps, agent, and channel summary', async () => {
    db.customer.findMany.mockResolvedValue([
      {
        id: 'cust_123',
        displayName: 'Alice Example',
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        memberships: [
          {
            createdAt: new Date('2026-04-01T10:00:00.000Z'),
            identity: {
              email: 'alice@example.com',
              claimStatus: 'active',
            },
          },
        ],
        agentBindings: [
          {
            provisionStatus: 'ready',
            agent: {
              id: 'agent_coke',
              slug: 'coke',
              name: 'Coke',
            },
          },
        ],
        externalIdentities: [
          {
            firstSeenAt: new Date('2026-04-03T12:00:00.000Z'),
          },
        ],
        channels: [
          {
            id: 'ch_1',
            type: 'whatsapp',
            status: 'connected',
          },
          {
            id: 'ch_2',
            type: 'wechat_personal',
            status: 'disconnected',
          },
        ],
      },
    ]);
    db.customer.count.mockResolvedValue(1);
    db.parkedInbound.findMany.mockResolvedValue([
      { payload: { customerId: 'cust_123' } },
    ]);

    const app = new Hono();
    app.route('/api/admin/customers', adminCustomersRouter);

    const res = await app.request('/api/admin/customers?limit=20&offset=0');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        rows: [
          {
            id: 'cust_123',
            displayName: 'Alice Example',
            contactIdentifier: {
              type: 'email',
              value: 'alice@example.com',
            },
            claimStatus: 'active',
            registeredAt: '2026-04-01T10:00:00.000Z',
            firstSeenAt: '2026-04-03T12:00:00.000Z',
            agent: {
              id: 'agent_coke',
              slug: 'coke',
              name: 'Coke',
              provisionStatus: 'ready',
            },
            channelSummary: {
              total: 2,
              connected: 1,
              disconnected: 1,
              kinds: ['wechat_personal', 'whatsapp'],
            },
            parkedInboundCount: 1,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      },
    });
    expect(db.customer.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      select: expect.any(Object),
      skip: 0,
      take: 20,
    });
    expect(db.customer.count).toHaveBeenCalledWith();
    expect(db.parkedInbound.findMany).toHaveBeenCalledWith({
      where: {
        status: 'queued',
        OR: [
          {
            payload: {
              path: ['customerId'],
              equals: 'cust_123',
            },
          },
          {
            payload: {
              path: ['customer_id'],
              equals: 'cust_123',
            },
          },
        ],
      },
      select: {
        payload: true,
      },
    });
  });

  it('rejects malformed paging params', async () => {
    const app = new Hono();
    app.route('/api/admin/customers', adminCustomersRouter);

    const res = await app.request('/api/admin/customers?limit=nope&offset=0');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'validation_error',
      issues: expect.any(Array),
    });
    expect(db.customer.findMany).not.toHaveBeenCalled();
    expect(db.customer.count).not.toHaveBeenCalled();
    expect(db.parkedInbound.findMany).not.toHaveBeenCalled();
  });

  it('rejects unknown query params', async () => {
    const app = new Hono();
    app.route('/api/admin/customers', adminCustomersRouter);

    const res = await app.request('/api/admin/customers?limt=10');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'validation_error',
      issues: expect.any(Array),
    });
    expect(db.customer.findMany).not.toHaveBeenCalled();
    expect(db.customer.count).not.toHaveBeenCalled();
    expect(db.parkedInbound.findMany).not.toHaveBeenCalled();
  });
});
