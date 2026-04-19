import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { EvolutionApiClient } from '../lib/evolution-api.js';
import { generateId } from '../lib/id.js';
import {
  buildPublicWhatsAppEvolutionConfig,
  parseStoredWhatsAppEvolutionConfig,
} from '../lib/whatsapp-evolution-config.js';
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

const evolutionConfigInputSchema = z
  .object({
    instanceName: z.string().trim().min(1),
  })
  .strict();

function getPlatformTenantId(): string {
  return process.env['COKE_PLATFORM_TENANT_ID'] ?? 'ten_1';
}

function getGatewayPublicBaseUrl(): string {
  const value = (process.env['NEXT_PUBLIC_API_URL'] ?? process.env['DOMAIN_CLIENT'] ?? '').trim();
  if (!value) {
    throw new Error('public_base_url_not_configured');
  }

  return value.replace(/\/$/, '');
}

function buildEvolutionWebhookUrl(channelId: string, webhookToken: string): string {
  return `${getGatewayPublicBaseUrl()}/gateway/evolution/whatsapp/${channelId}/${webhookToken}`;
}

function validationError(issues: z.ZodIssue[]) {
  return {
    ok: false as const,
    error: 'validation_error',
    issues,
  };
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
  const base = {
    id: row.id,
    name: row.name,
    kind: row.type,
    status: row.status,
    ownershipKind: row.ownershipKind,
    customerId: row.customerId,
    agent: row.sharedAgent ?? row.agent ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (row.type === 'whatsapp_evolution') {
    const storedConfig = parseStoredWhatsAppEvolutionConfig(row.config);
    return {
      ...base,
      ...(options?.includeConfig ? { config: buildPublicWhatsAppEvolutionConfig(row.config) } : {}),
      hasWebhookToken: Boolean(storedConfig.webhookToken),
    };
  }

  return {
    ...base,
    ...(options?.includeConfig ? { config: row.config ?? {} } : {}),
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
      return c.json(validationError(parsedQuery.error.issues), 400);
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
      return c.json(validationError(parsedBody.error.issues), 400);
    }

    let config: Prisma.InputJsonValue = parsedBody.data.config as Prisma.InputJsonValue;
    if (parsedBody.data.kind === 'whatsapp_evolution') {
      const parsedConfig = evolutionConfigInputSchema.safeParse(parsedBody.data.config);
      if (!parsedConfig.success) {
        return c.json(validationError(parsedConfig.error.issues), 400);
      }

      config = {
        instanceName: parsedConfig.data.instanceName,
        webhookToken: randomUUID(),
      } satisfies Prisma.InputJsonObject;
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
        config,
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
      return c.json(validationError(parsedBody.error.issues), 400);
    }

    const existing = await readSharedChannel(c.req.param('id')!);
    if (!existing) {
      return c.json({ ok: false, error: 'shared_channel_not_found' }, 404);
    }

    let config: Prisma.InputJsonValue | undefined;
    if (parsedBody.data.config !== undefined) {
      if (existing.type === 'whatsapp_evolution') {
        if ('webhookToken' in parsedBody.data.config) {
          return c.json({ ok: false, error: 'webhook_token_not_mutable' }, 400);
        }

        const parsedConfig = evolutionConfigInputSchema.safeParse(parsedBody.data.config);
        if (!parsedConfig.success) {
          return c.json(validationError(parsedConfig.error.issues), 400);
        }

        const storedConfig = parseStoredWhatsAppEvolutionConfig(existing.config);
        if (
          existing.status === 'connected' &&
          parsedConfig.data.instanceName !== storedConfig.instanceName
        ) {
          return c.json({ ok: false, error: 'disconnect_before_instance_change' }, 409);
        }

        config = {
          instanceName: parsedConfig.data.instanceName,
          webhookToken: storedConfig.webhookToken,
        } satisfies Prisma.InputJsonObject;
      } else {
        config = parsedBody.data.config as Prisma.InputJsonValue;
      }
    }

    const updated = await db.channel.update({
      where: { id: existing.id },
      data: {
        ...(parsedBody.data.name ? { name: parsedBody.data.name } : {}),
        ...(parsedBody.data.agentId
          ? { sharedAgent: { connect: { id: parsedBody.data.agentId } } }
          : {}),
        ...(config !== undefined ? { config } : {}),
      },
      select: sharedChannelSelect,
    });

    return c.json({
      ok: true,
      data: serializeSharedChannel(updated as never, { includeConfig: true }),
    });
  })
  .post('/:id/connect', async (c) => {
    const existing = await readSharedChannel(c.req.param('id')!);
    if (!existing) {
      return c.json({ ok: false, error: 'shared_channel_not_found' }, 404);
    }
    if (existing.type !== 'whatsapp_evolution') {
      return c.json({ ok: false, error: 'unsupported_shared_channel_kind' }, 409);
    }
    if (existing.status === 'connected') {
      return c.json({ ok: true, data: serializeSharedChannel(existing as never, { includeConfig: true }) });
    }

    const config = parseStoredWhatsAppEvolutionConfig(existing.config);
    try {
      await new EvolutionApiClient().setWebhook(
        config.instanceName,
        buildEvolutionWebhookUrl(existing.id, config.webhookToken),
      );
    } catch {
      return c.json({ ok: false, error: 'evolution_webhook_register_failed' }, 502);
    }

    const updated = await db.channel.update({
      where: { id: existing.id },
      data: { status: 'connected' },
      select: sharedChannelSelect,
    });

    return c.json({
      ok: true,
      data: serializeSharedChannel(updated as never, { includeConfig: true }),
    });
  })
  .post('/:id/disconnect', async (c) => {
    const existing = await readSharedChannel(c.req.param('id')!);
    if (!existing) {
      return c.json({ ok: false, error: 'shared_channel_not_found' }, 404);
    }
    if (existing.type !== 'whatsapp_evolution') {
      return c.json({ ok: false, error: 'unsupported_shared_channel_kind' }, 409);
    }
    if (existing.status === 'disconnected') {
      return c.json({ ok: true, data: serializeSharedChannel(existing as never, { includeConfig: true }) });
    }

    const config = parseStoredWhatsAppEvolutionConfig(existing.config);
    try {
      await new EvolutionApiClient().clearWebhook(config.instanceName);
    } catch {
      return c.json({ ok: false, error: 'evolution_webhook_clear_failed' }, 502);
    }

    const updated = await db.channel.update({
      where: { id: existing.id },
      data: { status: 'disconnected' },
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

    if (existing.type === 'whatsapp_evolution' && existing.status === 'connected') {
      const config = parseStoredWhatsAppEvolutionConfig(existing.config);
      try {
        await new EvolutionApiClient().clearWebhook(config.instanceName);
      } catch {
        return c.json({ ok: false, error: 'evolution_webhook_clear_failed' }, 502);
      }
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
