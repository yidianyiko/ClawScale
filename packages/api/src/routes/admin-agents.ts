import { Hono } from 'hono';
import { db } from '../db/index.js';
import { DEFAULT_COKE_AGENT_SLUG } from '../lib/platformization-migration.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

export const adminAgentsRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const agent = await db.agent.findFirst({
      where: {
        slug: DEFAULT_COKE_AGENT_SLUG,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        endpoint: true,
        authToken: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    if (!agent) {
      return c.json({ ok: false, error: 'agent_not_found' }, 404);
    }

    return c.json({
      ok: true,
      data: {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        endpoint: agent.endpoint,
        tokenConfigured: Boolean(agent.authToken),
        isDefault: agent.isDefault,
        lastHandshakeHealth: null,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
      },
    });
  });
