import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  customer: {
    count: vi.fn(),
  },
  conversation: {
    count: vi.fn(),
  },
  channel: {
    count: vi.fn(),
  },
  parkedInbound: {
    count: vi.fn(),
  },
  agentBinding: {
    groupBy: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (_c: any, next: any) => {
    await next();
  },
}));

import { adminDashboardRouter } from './admin-dashboard.js';

describe('admin dashboard route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active-user, message, customer, and runtime status metrics', async () => {
    db.$queryRaw.mockResolvedValue([
      {
        activeCustomers1d: 2n,
        activeCustomers7d: 4n,
        activeCustomers30d: 6n,
        messages1d: 10n,
        messages7d: 40n,
        messages30d: 80n,
        userMessages1d: 6n,
        assistantMessages1d: 4n,
        totalMessages: 100n,
        lastMessageAt: new Date('2026-05-20T03:00:00.000Z'),
      },
    ]);
    db.customer.count.mockResolvedValue(12);
    db.conversation.count.mockResolvedValue(8);
    db.channel.count.mockResolvedValue(5);
    db.parkedInbound.count.mockResolvedValue(3);
    db.agentBinding.groupBy.mockResolvedValue([
      { provisionStatus: 'ready', _count: { _all: 7 } },
      { provisionStatus: 'pending', _count: { _all: 2 } },
      { provisionStatus: 'error', _count: { _all: 1 } },
    ]);

    const app = new Hono();
    app.route('/api/admin/dashboard', adminDashboardRouter);

    const res = await app.request('/api/admin/dashboard');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        activeCustomers: {
          day: 2,
          week: 4,
          month: 6,
        },
        messages: {
          day: 10,
          week: 40,
          month: 80,
          userDay: 6,
          assistantDay: 4,
          total: 100,
          lastMessageAt: '2026-05-20T03:00:00.000Z',
        },
        customers: {
          total: 12,
        },
        conversations: {
          total: 8,
        },
        channels: {
          total: 5,
          connected: 5,
        },
        parkedInbounds: {
          queued: 3,
        },
        agentBindings: {
          ready: 7,
          pending: 2,
          error: 1,
        },
      },
    });
  });
});
