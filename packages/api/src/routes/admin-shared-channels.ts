import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

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
  'wechat_personal',
] as const;

const sharedChannelSelect = {
  id: true,
  name: true,
  type: true,
  status: true,
  ownershipKind: true,
  customerId: true,
  agentId: true,
  config: true,
  createdAt: true,
  updatedAt: true,
  sharedAgent: {
    select: {
      id: true,
      slug: true,
      name: true,
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

const createSchema = z
  .object({
    kind: z.enum(CHANNEL_KIND_VALUES),
    name: z.string().min(1).max(80),
    agentId: z.string().min(1),
    config: z.record(z.unknown()).optional().default({}),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    agentId: z.string().min(1).optional(),
    config: z.record(z.unknown()).optional(),
  })
  .strict();

function getPlatformTenantId(): string {
  return process.env['COKE_PLATFORM_TENANT_ID'] ?? 'ten_1';
}

const activeSharedChannelWhere = {
  ownershipKind: 'shared' as const,
  status: {
    not: 'archived' as const,
  },
};

function serializeSharedChannel(
  row: {
    id: string;
    name: string;
    type: (typeof CHANNEL_KIND_VALUES)[number];
    status: string;
    ownershipKind: 'shared';
    customerId: string | null;
    agentId: string | null;
    config?: unknown;
    createdAt: Date;
    updatedAt: Date;
    sharedAgent: { id: string; slug: string; name: string } | null;
    agent?: { id: string; slug: string; name: string } | null;
  },
  options?: { includeConfig?: boolean },
) {
  return {
    id: row.id,
    name: row.name,
    kind: row.type,
    status: row.status,
    ownershipKind: row.ownershipKind,
    customerId: row.customerId,
    agent: row.sharedAgent ?? row.agent ?? null,
    ...(options?.includeConfig ? { config: row.config ?? {} } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readSharedChannel(id: string) {
  const channel = await db.channel.findUnique({
    where: { id },
    select: sharedChannelSelect,
  });

  if (!channel || channel.ownershipKind !== 'shared' || channel.status === 'archived') {
    return null;
  }

  return channel;
}

export const adminSharedChannelsRouter = new Hono()
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

    const [rows, total] = await Promise.all([
      db.channel.findMany({
        where: activeSharedChannelWhere,
        select: sharedChannelSelect,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.channel.count({
        where: activeSharedChannelWhere,
      }),
    ]);

    return c.json({
      ok: true,
      data: {
        rows: rows.map((row) => serializeSharedChannel(row as never)),
        total,
        limit,
        offset,
      },
    });
  })
  .get('/:id', async (c) => {
    const channel = await readSharedChannel(c.req.param('id')!);
    if (!channel) {
      return c.json({ ok: false, error: 'shared_channel_not_found' }, 404);
    }

    return c.json({
      ok: true,
      data: serializeSharedChannel(channel as never, { includeConfig: true }),
    });
  })
  .post('/', async (c) => {
    const parsedBody = createSchema.safeParse(await c.req.json());
    if (!parsedBody.success) {
      return c.json(
        {
          ok: false,
          error: 'validation_error',
          issues: parsedBody.error.issues,
        },
        400,
      );
    }

    const created = await db.channel.create({
      data: {
        id: generateId('ch'),
        tenant: { connect: { id: getPlatformTenantId() } },
        type: parsedBody.data.kind,
        name: parsedBody.data.name,
        status: 'disconnected',
        ownershipKind: 'shared',
        sharedAgent: { connect: { id: parsedBody.data.agentId } },
        config: parsedBody.data.config as Prisma.InputJsonValue,
      },
      select: sharedChannelSelect,
    });

    return c.json(
      {
        ok: true,
        data: serializeSharedChannel(created as never, { includeConfig: true }),
      },
      201,
    );
  })
  .patch('/:id', async (c) => {
    const parsedBody = updateSchema.safeParse(await c.req.json());
    if (!parsedBody.success) {
      return c.json(
        {
          ok: false,
          error: 'validation_error',
          issues: parsedBody.error.issues,
        },
        400,
      );
    }

    const existing = await readSharedChannel(c.req.param('id')!);
    if (!existing) {
      return c.json({ ok: false, error: 'shared_channel_not_found' }, 404);
    }

    const updated = await db.channel.update({
      where: { id: existing.id },
      data: {
        ...(parsedBody.data.name ? { name: parsedBody.data.name } : {}),
        ...(parsedBody.data.agentId
          ? { sharedAgent: { connect: { id: parsedBody.data.agentId } } }
          : {}),
        ...(parsedBody.data.config
          ? { config: parsedBody.data.config as Prisma.InputJsonValue }
          : {}),
      },
      select: sharedChannelSelect,
    });

    return c.json({
      ok: true,
      data: serializeSharedChannel(updated as never, { includeConfig: true }),
    });
  })
  .delete('/:id', async (c) => {
    const existing = await readSharedChannel(c.req.param('id')!);
    if (!existing) {
      return c.json({ ok: false, error: 'shared_channel_not_found' }, 404);
    }

    await db.channel.update({
      where: { id: existing.id },
      data: {
        status: 'archived',
        config: {},
      },
    });

    return c.json({ ok: true, data: null });
  });
