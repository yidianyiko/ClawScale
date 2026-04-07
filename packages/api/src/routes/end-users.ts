import { Hono } from 'hono';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const endUserSelect = {
  id: true,
  tenantId: true,
  channelId: true,
  externalId: true,
  name: true,
  email: true,
  status: true,
  linkedTo: true,
  clawscaleUserId: true,
  clawscaleUser: { select: { id: true, cokeAccountId: true } },
  createdAt: true,
  updatedAt: true,
  channel: { select: { name: true, type: true } },
  _count: { select: { conversations: true } },
} as const;

export const endUsersRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/end-users ──────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const [rows, total] = await Promise.all([
      db.endUser.findMany({
        where: { tenantId },
        select: endUserSelect,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.endUser.count({ where: { tenantId } }),
    ]);

    return c.json({ ok: true, data: { rows, total } });
  })

  // ── GET /api/end-users/:id ──────────────────────────────────────────────────
  .get('/:id', async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const endUser = await db.endUser.findFirst({
      where: { id, tenantId },
      select: endUserSelect,
    });

    if (!endUser) return c.json({ ok: false, error: 'End user not found' }, 404);
    return c.json({ ok: true, data: endUser });
  });
