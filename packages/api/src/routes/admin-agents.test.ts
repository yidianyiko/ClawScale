import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  agent: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (_c: any, next: any) => {
    await next();
  },
}));

import { adminAgentsRouter } from './admin-agents.js';

describe('admin agents route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the single Coke agent detail', async () => {
    db.agent.findFirst.mockResolvedValue({
      id: 'agent_coke',
      slug: 'coke',
      name: 'Coke',
      endpoint: 'https://agent.example.com',
      authToken: 'secret-token',
      isDefault: true,
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });

    const app = new Hono();
    app.route('/api/admin/agents', adminAgentsRouter);

    const res = await app.request('/api/admin/agents');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
        endpoint: 'https://agent.example.com',
        tokenConfigured: true,
        isDefault: true,
        lastHandshakeHealth: null,
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-02T10:00:00.000Z',
      },
    });
    expect(db.agent.findFirst).toHaveBeenCalledWith({
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ],
      select: expect.any(Object),
      where: {
        slug: 'coke',
      },
    });
  });
});
