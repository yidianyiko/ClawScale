import { Hono } from 'hono';
import { db } from '../db/index.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

function parsePaging(search: URLSearchParams) {
  const limit = Math.min(Math.max(Number.parseInt(search.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(search.get('offset') ?? '0', 10) || 0, 0);

  return { limit, offset };
}

export const adminDeliveriesRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const url = new URL(c.req.url);
    const { limit, offset } = parsePaging(url.searchParams);
    const channelId = url.searchParams.get('channelId')?.trim() || undefined;

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
        orderBy: { createdAt: 'desc' },
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
