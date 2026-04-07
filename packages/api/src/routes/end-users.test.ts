import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  endUser: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set('auth', { tenantId: 'ten_1' });
    return next();
  },
}));

import { endUsersRouter } from './end-users.js';

describe('endUsersRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.endUser.findMany.mockResolvedValue([
      {
        id: 'eu_1',
        tenantId: 'ten_1',
        channelId: 'ch_1',
        externalId: 'wxid_123',
        name: 'Alice',
        email: 'alice@example.com',
        status: 'allowed',
        linkedTo: 'eu_legacy',
        clawscaleUserId: 'csu_1',
        clawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        channel: { name: 'WeChat', type: 'wechat' },
        _count: { conversations: 2 },
      },
    ]);
    db.endUser.count.mockResolvedValue(1);
  });

  it('returns unified identity fields in the admin list payload', async () => {
    const app = new Hono();
    app.route('/api/end-users', endUsersRouter);

    const res = await app.request('/api/end-users?limit=1&offset=0', {
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        rows: [
          {
            id: 'eu_1',
            tenantId: 'ten_1',
            channelId: 'ch_1',
            externalId: 'wxid_123',
            name: 'Alice',
            email: 'alice@example.com',
            status: 'allowed',
            linkedTo: 'eu_legacy',
            clawscaleUserId: 'csu_1',
            clawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            channel: { name: 'WeChat', type: 'wechat' },
            _count: { conversations: 2 },
          },
        ],
        total: 1,
      },
    });
  });

  it('returns unified identity fields for a single admin end-user record', async () => {
    db.endUser.findFirst.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      email: 'alice@example.com',
      status: 'allowed',
      linkedTo: 'eu_legacy',
      clawscaleUserId: 'csu_1',
      clawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      channel: { name: 'WeChat', type: 'wechat' },
      _count: { conversations: 2 },
    });

    const app = new Hono();
    app.route('/api/end-users', endUsersRouter);

    const res = await app.request('/api/end-users/eu_1', {
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'eu_1',
        tenantId: 'ten_1',
        channelId: 'ch_1',
        externalId: 'wxid_123',
        name: 'Alice',
        email: 'alice@example.com',
        status: 'allowed',
        linkedTo: 'eu_legacy',
        clawscaleUserId: 'csu_1',
        clawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        channel: { name: 'WeChat', type: 'wechat' },
        _count: { conversations: 2 },
      },
    });
    expect(db.endUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'eu_1', tenantId: 'ten_1' },
      }),
    );
  });
});
