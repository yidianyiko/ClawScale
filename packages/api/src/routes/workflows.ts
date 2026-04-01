import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';

const WORKFLOW_TYPES = ['script_js', 'script_python', 'script_shell', 'n8n', 'pulse_editor'] as const;

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  type: z.enum(WORKFLOW_TYPES),
  code: z.string().optional(),
  config: z.record(z.unknown()).default({}),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  code: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const workflowsRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/workflows ───────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db.workflow.findMany({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        type: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        // code and config omitted in list view
      },
    });

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/workflows ──────────────────────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const body = c.req.valid('json');

    const id = generateId('wf');
    await db.workflow.create({
      data: {
        id,
        tenantId,
        name: body.name,
        description: body.description,
        type: body.type,
        code: body.code,
        config: body.config,
      },
    });

    await audit({ tenantId, memberId: userId, action: 'create_workflow', resource: 'workflow', resourceId: id });

    const created = await db.workflow.findUnique({ where: { id } });
    return c.json({ ok: true, data: created }, 201);
  })

  // ── GET /api/workflows/:id ───────────────────────────────────────────────────
  .get('/:id', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const workflow = await db.workflow.findFirst({ where: { id, tenantId } });
    if (!workflow) return c.json({ ok: false, error: 'Workflow not found' }, 404);

    return c.json({ ok: true, data: workflow });
  })

  // ── PATCH /api/workflows/:id ─────────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const existing = await db.workflow.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) return c.json({ ok: false, error: 'Workflow not found' }, 404);

    await db.workflow.update({ where: { id }, data: body });
    await audit({ tenantId, memberId: userId, action: 'update_workflow', resource: 'workflow', resourceId: id });

    const updated = await db.workflow.findUnique({ where: { id } });
    return c.json({ ok: true, data: updated });
  })

  // ── DELETE /api/workflows/:id ────────────────────────────────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id');

    const existing = await db.workflow.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) return c.json({ ok: false, error: 'Workflow not found' }, 404);

    await db.workflow.delete({ where: { id: existing.id } });
    await audit({ tenantId, memberId: userId, action: 'delete_workflow', resource: 'workflow', resourceId: existing.id });

    return c.json({ ok: true, data: null });
  });
