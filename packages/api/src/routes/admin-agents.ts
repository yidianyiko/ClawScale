import { Hono } from 'hono';
import { db } from '../db/index.js';
import { DEFAULT_COKE_AGENT_SLUG } from '../lib/platformization-migration.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

type AgentBindingProvisionStatus = 'ready' | 'pending' | 'error';

function deriveLastHandshakeHealth(
  binding:
    | {
        provisionStatus: AgentBindingProvisionStatus;
        provisionUpdatedAt: Date;
      }
    | undefined,
) {
  if (!binding) {
    return {
      status: 'unknown',
      source: 'agent_binding_provision_status',
      observedAt: null,
    } as const;
  }

  // Phase 1 has no dedicated handshake-health persistence. We derive the
  // operational signal from the latest Coke agent binding state instead:
  // ready -> healthy, pending -> pending, error -> error.
  const status =
    binding.provisionStatus === 'ready'
      ? 'healthy'
      : binding.provisionStatus === 'pending'
        ? 'pending'
        : 'error';

  return {
    status,
    source: 'agent_binding_provision_status',
    observedAt: binding.provisionUpdatedAt.toISOString(),
  } as const;
}

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
        bindings: {
          orderBy: {
            provisionUpdatedAt: 'desc',
          },
          take: 1,
          select: {
            provisionStatus: true,
            provisionUpdatedAt: true,
          },
        },
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
        lastHandshakeHealth: deriveLastHandshakeHealth(agent.bindings[0]),
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
      },
    });
  });
