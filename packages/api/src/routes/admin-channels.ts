import { Hono } from 'hono';
import { db } from '../db/index.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

const CHANNEL_STATUS_VALUES = ['connected', 'disconnected', 'pending', 'error', 'archived'] as const;
const CHANNEL_KIND_VALUES = [
  'whatsapp',
  'telegram',
  'slack',
  'discord',
  'instagram',
  'facebook',
  'line',
  'signal',
  'teams',
  'matrix',
  'web',
  'wechat_work',
  'whatsapp_business',
  'wechat_personal',
] as const;

type ChannelStatusFilter = (typeof CHANNEL_STATUS_VALUES)[number];
type ChannelKindFilter = (typeof CHANNEL_KIND_VALUES)[number];

function parsePaging(search: URLSearchParams) {
  const limit = Math.min(Math.max(Number.parseInt(search.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(search.get('offset') ?? '0', 10) || 0, 0);

  return { limit, offset };
}

function parseStatus(value: string | null): ChannelStatusFilter | undefined {
  if (!value) {
    return undefined;
  }

  return CHANNEL_STATUS_VALUES.includes(value as ChannelStatusFilter)
    ? (value as ChannelStatusFilter)
    : undefined;
}

function parseKind(value: string | null): ChannelKindFilter | undefined {
  if (!value) {
    return undefined;
  }

  return CHANNEL_KIND_VALUES.includes(value as ChannelKindFilter)
    ? (value as ChannelKindFilter)
    : undefined;
}

export const adminChannelsRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const url = new URL(c.req.url);
    const { limit, offset } = parsePaging(url.searchParams);
    const status = parseStatus(url.searchParams.get('status')?.trim() ?? null);
    const kind = parseKind(url.searchParams.get('kind')?.trim() ?? null);

    const where: {
      ownershipKind: 'customer';
      status?: ChannelStatusFilter;
      type?: ChannelKindFilter;
    } = {
      ownershipKind: 'customer',
      ...(status ? { status } : {}),
      ...(kind ? { type: kind } : {}),
    };

    const [rows, total] = await Promise.all([
      db.channel.findMany({
        where,
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          ownershipKind: true,
          customerId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.channel.count({ where }),
    ]);

    return c.json({
      ok: true,
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.type,
          status: row.status,
          ownershipKind: row.ownershipKind,
          customerId: row.customerId,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      },
    });
  });
