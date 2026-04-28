import { Hono } from 'hono';
import { z } from 'zod';
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
  'whatsapp_evolution',
  'linq',
  'wechat_personal',
  'wechat_ecloud',
] as const;

const listQuerySchema = z
  .object({
    status: z.enum(CHANNEL_STATUS_VALUES).optional(),
    kind: z.enum(CHANNEL_KIND_VALUES).optional(),
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

type ChannelStatusFilter = (typeof CHANNEL_STATUS_VALUES)[number];
type ChannelKindFilter = (typeof CHANNEL_KIND_VALUES)[number];

export const adminChannelsRouter = new Hono()
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
    const status = parsedQuery.data.status;
    const kind = parsedQuery.data.kind;

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
