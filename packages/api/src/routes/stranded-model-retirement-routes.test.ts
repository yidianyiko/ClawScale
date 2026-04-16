import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  conversation: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  message: {
    deleteMany: vi.fn(),
  },
  aiBackend: {
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  endUserBackend: {
    deleteMany: vi.fn(),
  },
  workflow: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('auth', { tenantId: 'ten_1', userId: 'mem_1', role: 'admin' });
    return next();
  },
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
}));

import { conversationsRouter } from './conversations.js';
import { aiBackendsRouter } from './ai-backends.js';
import { workflowsRouter } from './workflows.js';

describe('stranded model retirement tombstones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      label: 'conversations',
      path: '/api/conversations',
      method: 'GET',
      router: conversationsRouter,
    },
    {
      label: 'ai-backends',
      path: '/api/ai-backends',
      method: 'POST',
      router: aiBackendsRouter,
    },
    {
      label: 'workflows',
      path: '/api/workflows/wf_1',
      method: 'DELETE',
      router: workflowsRouter,
    },
  ])('returns a stable gone payload for $label routes', async ({ path, method, router }) => {
    const app = new Hono();
    const mountPath = path.startsWith('/api/conversations')
      ? '/api/conversations'
      : path.startsWith('/api/ai-backends')
        ? '/api/ai-backends'
        : '/api/workflows';
    app.route(mountPath, router);

    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ name: 'legacy' }) : undefined,
    });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'moved_to_agent_storage',
    });
  });
});
