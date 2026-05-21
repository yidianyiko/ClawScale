import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
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
    db.$queryRaw.mockResolvedValue([
      {
        customerId: 'cust_123',
        lastMessageAt: new Date('2026-04-04T12:30:00.000Z'),
        conversationCount: 1,
        messageCount: 3,
      },
    ]);
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
            lastMessageAt: '2026-04-04T12:30:00.000Z',
            conversationCount: 1,
            messageCount: 3,
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
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.customer.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['cust_123'],
        },
      },
      select: expect.any(Object),
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

  it('requests customers ordered by latest message recency', async () => {
    db.$queryRaw.mockResolvedValue([
      {
        customerId: 'cust_new_chat',
        lastMessageAt: new Date('2026-04-06T12:00:00.000Z'),
        conversationCount: 1,
        messageCount: 1,
      },
      {
        customerId: 'cust_old_chat',
        lastMessageAt: new Date('2026-04-05T12:00:00.000Z'),
        conversationCount: 1,
        messageCount: 1,
      },
    ]);
    db.customer.findMany.mockResolvedValue([
      {
        id: 'cust_old_chat',
        displayName: 'Old Chat',
        createdAt: new Date('2026-04-10T10:00:00.000Z'),
        memberships: [],
        agentBindings: [],
        externalIdentities: [],
        channels: [],
      },
      {
        id: 'cust_new_chat',
        displayName: 'New Chat',
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        memberships: [],
        agentBindings: [],
        externalIdentities: [],
        channels: [],
      },
    ]);
    db.customer.count.mockResolvedValue(2);
    db.parkedInbound.findMany.mockResolvedValue([]);

    const app = new Hono();
    app.route('/api/admin/customers', adminCustomersRouter);

    const res = await app.request('/api/admin/customers?limit=20&offset=0');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.rows.map((row: { id: string }) => row.id)).toEqual([
      'cust_new_chat',
      'cust_old_chat',
    ]);
    expect(body.data.rows[0]).toMatchObject({
      id: 'cust_new_chat',
      lastMessageAt: '2026-04-06T12:00:00.000Z',
      messageCount: 1,
      conversationCount: 1,
    });
  });
});
