import { Hono } from 'hono';
import { db } from '../db/index.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

type DashboardMessageRow = {
  activeCustomers1d: number | bigint | null;
  activeCustomers7d: number | bigint | null;
  activeCustomers30d: number | bigint | null;
  messages1d: number | bigint | null;
  messages7d: number | bigint | null;
  messages30d: number | bigint | null;
  userMessages1d: number | bigint | null;
  assistantMessages1d: number | bigint | null;
  totalMessages: number | bigint | null;
  lastMessageAt: Date | string | null;
};

type AgentBindingGroup = {
  provisionStatus: string;
  _count: {
    _all: number;
  };
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

async function readDashboardMessageMetrics(): Promise<DashboardMessageRow> {
  const rows = await db.$queryRaw<DashboardMessageRow[]>`
    WITH message_customer_links AS (
      SELECT DISTINCT
        cu.coke_account_id AS customer_id,
        msg.id AS message_id,
        msg.role AS role,
        msg.created_at AS created_at
      FROM messages AS msg
      JOIN conversations AS conv ON conv.id = msg.conversation_id
      JOIN clawscale_users AS cu ON cu.id = conv.clawscale_user_id

      UNION

      SELECT DISTINCT
        ch.customer_id AS customer_id,
        msg.id AS message_id,
        msg.role AS role,
        msg.created_at AS created_at
      FROM messages AS msg
      JOIN conversations AS conv ON conv.id = msg.conversation_id
      JOIN channels AS ch ON ch.id = conv.channel_id
      WHERE ch.customer_id IS NOT NULL

      UNION

      SELECT DISTINCT
        COALESCE(
          msg.metadata #>> '{customerId}',
          msg.metadata #>> '{customer_id}',
          msg.metadata #>> '{cokeAccountId}',
          msg.metadata #>> '{coke_account_id}'
        ) AS customer_id,
        msg.id AS message_id,
        msg.role AS role,
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
      COUNT(DISTINCT customer_id) FILTER (
        WHERE role = 'user' AND created_at >= NOW() - INTERVAL '1 day'
      ) AS "activeCustomers1d",
      COUNT(DISTINCT customer_id) FILTER (
        WHERE role = 'user' AND created_at >= NOW() - INTERVAL '7 days'
      ) AS "activeCustomers7d",
      COUNT(DISTINCT customer_id) FILTER (
        WHERE role = 'user' AND created_at >= NOW() - INTERVAL '30 days'
      ) AS "activeCustomers30d",
      COUNT(DISTINCT message_id) FILTER (
        WHERE created_at >= NOW() - INTERVAL '1 day'
      ) AS "messages1d",
      COUNT(DISTINCT message_id) FILTER (
        WHERE created_at >= NOW() - INTERVAL '7 days'
      ) AS "messages7d",
      COUNT(DISTINCT message_id) FILTER (
        WHERE created_at >= NOW() - INTERVAL '30 days'
      ) AS "messages30d",
      COUNT(DISTINCT message_id) FILTER (
        WHERE role = 'user' AND created_at >= NOW() - INTERVAL '1 day'
      ) AS "userMessages1d",
      COUNT(DISTINCT message_id) FILTER (
        WHERE role = 'assistant' AND created_at >= NOW() - INTERVAL '1 day'
      ) AS "assistantMessages1d",
      COUNT(DISTINCT message_id) AS "totalMessages",
      MAX(created_at) AS "lastMessageAt"
    FROM message_customer_links
    WHERE customer_id IS NOT NULL
  `;

  return rows[0] ?? {
    activeCustomers1d: 0,
    activeCustomers7d: 0,
    activeCustomers30d: 0,
    messages1d: 0,
    messages7d: 0,
    messages30d: 0,
    userMessages1d: 0,
    assistantMessages1d: 0,
    totalMessages: 0,
    lastMessageAt: null,
  };
}

function bindingCount(groups: AgentBindingGroup[], status: string): number {
  return groups.find((group) => group.provisionStatus === status)?._count._all ?? 0;
}

export const adminDashboardRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const [
      messageMetrics,
      totalCustomers,
      totalConversations,
      connectedChannels,
      totalChannels,
      queuedParkedInbounds,
      agentBindingGroups,
    ] = await Promise.all([
      readDashboardMessageMetrics(),
      db.customer.count(),
      db.conversation.count(),
      db.channel.count({ where: { status: 'connected' } }),
      db.channel.count(),
      db.parkedInbound.count({ where: { status: 'queued' } }),
      db.agentBinding.groupBy({
        by: ['provisionStatus'],
        _count: {
          _all: true,
        },
      }),
    ]);

    const groups = agentBindingGroups as AgentBindingGroup[];

    return c.json({
      ok: true,
      data: {
        activeCustomers: {
          day: toNumber(messageMetrics.activeCustomers1d),
          week: toNumber(messageMetrics.activeCustomers7d),
          month: toNumber(messageMetrics.activeCustomers30d),
        },
        messages: {
          day: toNumber(messageMetrics.messages1d),
          week: toNumber(messageMetrics.messages7d),
          month: toNumber(messageMetrics.messages30d),
          userDay: toNumber(messageMetrics.userMessages1d),
          assistantDay: toNumber(messageMetrics.assistantMessages1d),
          total: toNumber(messageMetrics.totalMessages),
          lastMessageAt: toIso(messageMetrics.lastMessageAt),
        },
        customers: {
          total: totalCustomers,
        },
        conversations: {
          total: totalConversations,
        },
        channels: {
          total: totalChannels,
          connected: connectedChannels,
        },
        parkedInbounds: {
          queued: queuedParkedInbounds,
        },
        agentBindings: {
          ready: bindingCount(groups, 'ready'),
          pending: bindingCount(groups, 'pending'),
          error: bindingCount(groups, 'error'),
        },
      },
    });
  });
