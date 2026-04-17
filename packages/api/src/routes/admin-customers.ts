import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

const customerSelect = {
  id: true,
  displayName: true,
  createdAt: true,
  memberships: {
    where: {
      role: 'owner',
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 1,
    select: {
      createdAt: true,
      identity: {
        select: {
          claimStatus: true,
          email: true,
        },
      },
    },
  },
  agentBindings: {
    orderBy: {
      createdAt: 'asc',
    },
    take: 1,
    select: {
      provisionStatus: true,
      agent: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
    },
  },
  externalIdentities: {
    orderBy: {
      firstSeenAt: 'asc',
    },
    take: 1,
    select: {
      provider: true,
      identityType: true,
      identityValue: true,
      firstSeenAt: true,
    },
  },
  channels: {
    select: {
      id: true,
      type: true,
      status: true,
    },
  },
} as const;

const listQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(200))
      .optional(),
    offset: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(0))
      .optional(),
  })
  .strict();

function buildContactIdentifier(row: {
  memberships: Array<{
    identity: {
      claimStatus: 'active' | 'unclaimed' | 'pending';
      email: string | null;
    };
  }>;
  externalIdentities: Array<{
    provider: string;
    identityType: string;
    identityValue: string;
  }>;
}) {
  const owner = row.memberships[0]?.identity;
  if (owner?.claimStatus === 'active' && owner.email) {
    return {
      type: 'email',
      value: owner.email,
    };
  }

  const externalIdentity = row.externalIdentities[0];
  if (externalIdentity) {
    return {
      type: `${externalIdentity.provider}:${externalIdentity.identityType}`,
      value: externalIdentity.identityValue,
    };
  }

  return {
    type: 'unknown',
    value: '',
  };
}

export const adminCustomersRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const url = new URL(c.req.url);
    const parsedQuery = listQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );

    if (!parsedQuery.success) {
      return c.json(
        {
          ok: false,
          error: 'validation_error',
          issues: parsedQuery.error.issues,
        },
        400,
      );
    }

    const limit = parsedQuery.data.limit ?? 50;
    const offset = parsedQuery.data.offset ?? 0;

    const [rows, total] = await Promise.all([
      db.customer.findMany({
        orderBy: { createdAt: 'desc' },
        select: customerSelect,
        skip: offset,
        take: limit,
      }),
      db.customer.count(),
    ]);

    return c.json({
      ok: true,
      data: {
        rows: rows.map((row) => {
          const ownerMembership = row.memberships[0];
          const agentBinding = row.agentBindings[0];
          const firstSeenIdentity = row.externalIdentities[0];
          const channelKinds = [...new Set(row.channels.map((channel) => channel.type))].sort();

          return {
            id: row.id,
            displayName: row.displayName,
            contactIdentifier: buildContactIdentifier(row),
            claimStatus: ownerMembership?.identity.claimStatus ?? 'unclaimed',
            registeredAt: ownerMembership?.createdAt?.toISOString() ?? row.createdAt.toISOString(),
            firstSeenAt: firstSeenIdentity?.firstSeenAt?.toISOString() ?? null,
            agent: agentBinding
              ? {
                  id: agentBinding.agent.id,
                  slug: agentBinding.agent.slug,
                  name: agentBinding.agent.name,
                  provisionStatus: agentBinding.provisionStatus,
                }
              : null,
            channelSummary: {
              total: row.channels.length,
              connected: row.channels.filter((channel) => channel.status === 'connected').length,
              disconnected: row.channels.filter((channel) => channel.status === 'disconnected').length,
              kinds: channelKinds,
            },
          };
        }),
        total,
        limit,
        offset,
      },
    });
  });
