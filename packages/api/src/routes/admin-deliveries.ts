import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

const listQuerySchema = z.object({
  channelId: z.string().min(1).optional(),
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
});

export const adminDeliveriesRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const url = new URL(c.req.url);
    const parsedQuery = listQuerySchema.safeParse({
      channelId: url.searchParams.get('channelId') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });

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
    const channelId = parsedQuery.data.channelId;

    const where = {
      status: 'failed',
      ...(channelId ? { channelId } : {}),
    };

    const [rows, total] = await Promise.all([
      db.outboundDelivery.findMany({
        where,
        select: {
          id: true,
          tenantId: true,
          channelId: true,
          idempotencyKey: true,
          status: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.outboundDelivery.count({ where }),
    ]);

    return c.json({
      ok: true,
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          channelId: row.channelId,
          idempotencyKey: row.idempotencyKey,
          status: row.status,
          error: row.error,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      },
    });
  });
