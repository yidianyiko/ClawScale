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

type CustomerMessageStatsRow = {
  customerId: string;
  lastMessageAt: Date | string | null;
  conversationCount: number | bigint | null;
  messageCount: number | bigint | null;
};

function toNumber(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'number') {
    return value;
  }

  return 0;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

async function listCustomerMessageStats(
  limit: number,
  offset: number,
): Promise<CustomerMessageStatsRow[]> {
  return db.$queryRaw<CustomerMessageStatsRow[]>`
    WITH message_customer_links AS (
      SELECT
        cu.coke_account_id AS customer_id,
        conv.id AS conversation_id,
        msg.id AS message_id,
        msg.created_at AS created_at
      FROM messages AS msg
      JOIN conversations AS conv ON conv.id = msg.conversation_id
      JOIN clawscale_users AS cu ON cu.id = conv.clawscale_user_id

      UNION ALL

      SELECT
        ch.customer_id AS customer_id,
        conv.id AS conversation_id,
        msg.id AS message_id,
        msg.created_at AS created_at
      FROM messages AS msg
      JOIN conversations AS conv ON conv.id = msg.conversation_id
      JOIN channels AS ch ON ch.id = conv.channel_id
      WHERE ch.customer_id IS NOT NULL

      UNION ALL

      SELECT
        COALESCE(
          msg.metadata #>> '{customerId}',
          msg.metadata #>> '{customer_id}',
          msg.metadata #>> '{cokeAccountId}',
          msg.metadata #>> '{coke_account_id}'
        ) AS customer_id,
        msg.conversation_id AS conversation_id,
        msg.id AS message_id,
        msg.created_at AS created_at
      FROM messages AS msg
      WHERE COALESCE(
        msg.metadata #>> '{customerId}',
        msg.metadata #>> '{customer_id}',
        msg.metadata #>> '{cokeAccountId}',
        msg.metadata #>> '{coke_account_id}'
      ) IS NOT NULL
    )
    SELECT
      c.id AS "customerId",
      MAX(message_customer_links.created_at) AS "lastMessageAt",
      COUNT(DISTINCT message_customer_links.conversation_id)::int AS "conversationCount",
      COUNT(DISTINCT message_customer_links.message_id)::int AS "messageCount"
    FROM customers AS c
    LEFT JOIN message_customer_links ON message_customer_links.customer_id = c.id
    GROUP BY c.id, c.created_at
    ORDER BY MAX(message_customer_links.created_at) DESC NULLS LAST, c.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

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

function readParkedCustomerId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const customerId = record['customerId'];
  if (typeof customerId === 'string' && customerId.trim()) {
    return customerId.trim();
  }

  const legacyCustomerId = record['customer_id'];
  if (typeof legacyCustomerId === 'string' && legacyCustomerId.trim()) {
    return legacyCustomerId.trim();
  }

  return null;
}

export const adminCustomersRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const url = new URL(c.req.url);
    const parsedQuery = listQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

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

    const [messageStatsRows, total] = await Promise.all([
      listCustomerMessageStats(limit, offset),
      db.customer.count(),
    ]);
    const orderedCustomerIds = messageStatsRows.map((row) => row.customerId);
    const statsByCustomerId = new Map(
      messageStatsRows.map((row) => [row.customerId, row] as const),
    );

    const rows = orderedCustomerIds.length
      ? await db.customer.findMany({
        where: {
          id: {
            in: orderedCustomerIds,
          },
        },
        select: customerSelect,
      })
      : [];
    const rowsById = new Map(rows.map((row) => [row.id, row] as const));
    const orderedRows = orderedCustomerIds
      .map((customerId) => rowsById.get(customerId))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const customerIds = orderedRows.map((row) => row.id);
    const parkedInbounds = customerIds.length
      ? await db.parkedInbound.findMany({
          where: {
            status: 'queued',
            OR: customerIds.flatMap((customerId) => [
              {
                payload: {
                  path: ['customerId'],
                  equals: customerId,
                },
              },
              {
                payload: {
                  path: ['customer_id'],
                  equals: customerId,
                },
              },
            ]),
          },
          select: {
            payload: true,
          },
        })
      : [];

    const parkedInboundCounts = new Map<string, number>();
    for (const row of parkedInbounds as Array<{ payload: unknown }>) {
      const customerId = readParkedCustomerId(row.payload);
      if (!customerId) {
        continue;
      }

      parkedInboundCounts.set(customerId, (parkedInboundCounts.get(customerId) ?? 0) + 1);
    }

    return c.json({
      ok: true,
      data: {
        rows: orderedRows.map((row) => {
          const ownerMembership = row.memberships[0];
          const agentBinding = row.agentBindings[0];
          const firstSeenIdentity = row.externalIdentities[0];
          const channelKinds = [...new Set(row.channels.map((channel) => channel.type))].sort();
          const messageStats = statsByCustomerId.get(row.id);

          return {
            id: row.id,
            displayName: row.displayName,
            contactIdentifier: buildContactIdentifier(row),
            claimStatus: ownerMembership?.identity.claimStatus ?? 'unclaimed',
            registeredAt: ownerMembership?.createdAt?.toISOString() ?? row.createdAt.toISOString(),
            firstSeenAt: firstSeenIdentity?.firstSeenAt?.toISOString() ?? null,
            lastMessageAt: toIso(messageStats?.lastMessageAt),
            conversationCount: toNumber(messageStats?.conversationCount),
            messageCount: toNumber(messageStats?.messageCount),
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
            parkedInboundCount: parkedInboundCounts.get(row.id) ?? 0,
          };
        }),
        total,
        limit,
        offset,
      },
    });
  });
