import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { EvolutionApiClient } from '../lib/evolution-api.js';
import { generateId } from '../lib/id.js';
import {
  buildPublicWhatsAppEvolutionConfig,
  ensureStoredWhatsAppEvolutionConfig,
  hasWhatsAppEvolutionWebhookToken,
  parseWhatsAppEvolutionConfig,
  type StoredWhatsAppEvolutionConfig,
  type WhatsAppEvolutionConfig,
} from '../lib/whatsapp-evolution-config.js';
import {
  buildPublicWechatEcloudConfig,
  ensureStoredWechatEcloudConfig,
  hasWechatEcloudWebhookToken,
  parseStoredWechatEcloudConfig,
  parseWechatEcloudConfigInput,
  type StoredWechatEcloudConfig,
} from '../lib/wechat-ecloud-config.js';
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
  'wechat_ecloud',
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

type SharedChannelRow = Prisma.ChannelGetPayload<{ select: typeof sharedChannelSelect }>;

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

function parseEvolutionConfigInput(config: Record<string, unknown>) {
  const parsed = evolutionConfigInputSchema.safeParse(config);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError(parsed.error.issues),
    };
  }

  return {
    ok: true as const,
    data: parsed.data,
  };
}

function buildStoredEvolutionConfig(
  instanceName: string,
  webhookToken: string,
): Prisma.InputJsonObject & StoredWhatsAppEvolutionConfig {
  return {
    instanceName,
    webhookToken,
  };
}

function buildStoredEcloudConfig(
  config: StoredWechatEcloudConfig,
): Prisma.InputJsonObject & StoredWechatEcloudConfig {
  return {
    appId: config.appId,
    token: config.token,
    baseUrl: config.baseUrl,
    webhookToken: config.webhookToken,
  };
}

function parseEcloudConfigInput(config: Record<string, unknown>) {
  if ('webhookToken' in config) {
    return {
      ok: false as const,
      response: { ok: false as const, error: 'webhook_token_not_mutable' },
    };
  }

  try {
    return {
      ok: true as const,
      data: parseWechatEcloudConfigInput(config),
    };
  } catch (error) {
    return {
      ok: false as const,
      response: {
        ok: false as const,
        error: error instanceof Error ? error.message : 'invalid_wechat_ecloud_config',
      },
    };
  }
}

async function ensureEvolutionWebhookToken(
  channel: SharedChannelRow,
): Promise<{ channel: SharedChannelRow; config: StoredWhatsAppEvolutionConfig }> {
  const config = ensureStoredWhatsAppEvolutionConfig(channel.config, randomUUID);
  if (hasWhatsAppEvolutionWebhookToken(channel.config)) {
    return { channel, config };
  }

  const updated = await db.channel.update({
    where: { id: channel.id },
    data: {
      config: buildStoredEvolutionConfig(config.instanceName, config.webhookToken),
    },
    select: sharedChannelSelect,
  });

  return {
    channel: updated as SharedChannelRow,
    config,
  };
}

async function rollbackEvolutionConnect(client: EvolutionApiClient, instanceName: string) {
  try {
    await client.clearWebhook(instanceName);
  } catch (error) {
    console.error('[shared-channel:evolution] Failed to roll back webhook registration:', error);
  }
}

async function rollbackEvolutionDisconnect(
  client: EvolutionApiClient,
  channelId: string,
  config: WhatsAppEvolutionConfig,
) {
  if (!config.webhookToken) {
    return;
  }

  try {
    await client.setWebhook(config.instanceName, buildEvolutionWebhookUrl(channelId, config.webhookToken));
  } catch (error) {
    console.error('[shared-channel:evolution] Failed to restore webhook after DB failure:', error);
  }
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
    return {
      ...base,
      ...(options?.includeConfig ? { config: buildPublicWhatsAppEvolutionConfig(row.config) } : {}),
      hasWebhookToken: hasWhatsAppEvolutionWebhookToken(row.config),
    };
  }

  if (row.type === 'wechat_ecloud') {
    return {
      ...base,
      ...(options?.includeConfig ? { config: buildPublicWechatEcloudConfig(row.config) } : {}),
      hasWebhookToken: hasWechatEcloudWebhookToken(row.config),
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

  return channel as SharedChannelRow;
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
      const parsedConfig = parseEvolutionConfigInput(parsedBody.data.config);
      if (!parsedConfig.ok) {
        return c.json(parsedConfig.response, 400);
      }

      config = buildStoredEvolutionConfig(parsedConfig.data.instanceName, randomUUID());
    } else if (parsedBody.data.kind === 'wechat_ecloud') {
      const parsedConfig = parseEcloudConfigInput(parsedBody.data.config);
      if (!parsedConfig.ok) {
        return c.json(parsedConfig.response, 400);
      }

      config = buildStoredEcloudConfig(
        ensureStoredWechatEcloudConfig(parsedConfig.data, randomUUID),
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

        const parsedConfig = parseEvolutionConfigInput(parsedBody.data.config);
        if (!parsedConfig.ok) {
          return c.json(parsedConfig.response, 400);
        }

        const storedConfig = ensureStoredWhatsAppEvolutionConfig(existing.config, randomUUID);
        if (
          existing.status === 'connected' &&
          parsedConfig.data.instanceName !== storedConfig.instanceName
        ) {
          return c.json({ ok: false, error: 'disconnect_before_instance_change' }, 409);
        }

        config = buildStoredEvolutionConfig(
          parsedConfig.data.instanceName,
          storedConfig.webhookToken,
        );
      } else if (existing.type === 'wechat_ecloud') {
        if ('webhookToken' in parsedBody.data.config) {
          return c.json({ ok: false, error: 'webhook_token_not_mutable' }, 400);
        }
        if ('token' in parsedBody.data.config) {
          return c.json({ ok: false, error: 'token_not_mutable' }, 400);
        }
        if (existing.status === 'connected') {
          return c.json({ ok: false, error: 'disconnect_before_config_change' }, 409);
        }

        let storedConfig: StoredWechatEcloudConfig;
        try {
          storedConfig = parseStoredWechatEcloudConfig(existing.config);
        } catch (error) {
          return c.json(
            {
              ok: false,
              error: error instanceof Error ? error.message : 'invalid_wechat_ecloud_config',
            },
            409,
          );
        }

        const mergedConfig = {
          appId:
            typeof parsedBody.data.config.appId === 'string'
              ? parsedBody.data.config.appId
              : storedConfig.appId,
          token: storedConfig.token,
          baseUrl:
            typeof parsedBody.data.config.baseUrl === 'string'
              ? parsedBody.data.config.baseUrl
              : storedConfig.baseUrl,
          webhookToken: storedConfig.webhookToken,
        };

        config = buildStoredEcloudConfig(
          ensureStoredWechatEcloudConfig(mergedConfig, () => storedConfig.webhookToken),
        );
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
    if (existing.type !== 'whatsapp_evolution' && existing.type !== 'wechat_ecloud') {
      return c.json({ ok: false, error: 'unsupported_shared_channel_kind' }, 409);
    }
    if (existing.status === 'connected') {
      return c.json({ ok: true, data: serializeSharedChannel(existing as never, { includeConfig: true }) });
    }

    if (existing.type === 'wechat_ecloud') {
      try {
        parseStoredWechatEcloudConfig(existing.config);
      } catch (error) {
        return c.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : 'invalid_wechat_ecloud_config',
          },
          409,
        );
      }

      const updated = (await db.channel.update({
        where: { id: existing.id },
        data: { status: 'connected' },
        select: sharedChannelSelect,
      })) as SharedChannelRow;

      return c.json({
        ok: true,
        data: serializeSharedChannel(updated as never, { includeConfig: true }),
      });
    }

    const client = new EvolutionApiClient();
    const prepared = await ensureEvolutionWebhookToken(existing);
    const webhookUrl = buildEvolutionWebhookUrl(prepared.channel.id, prepared.config.webhookToken);

    try {
      await client.setWebhook(prepared.config.instanceName, webhookUrl);
    } catch {
      return c.json({ ok: false, error: 'evolution_webhook_register_failed' }, 502);
    }

    let updated: SharedChannelRow;
    try {
      updated = (await db.channel.update({
        where: { id: prepared.channel.id },
        data: { status: 'connected' },
        select: sharedChannelSelect,
      })) as SharedChannelRow;
    } catch (error) {
      await rollbackEvolutionConnect(client, prepared.config.instanceName);
      throw error;
    }

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
    if (existing.type !== 'whatsapp_evolution' && existing.type !== 'wechat_ecloud') {
      return c.json({ ok: false, error: 'unsupported_shared_channel_kind' }, 409);
    }
    if (existing.status === 'disconnected') {
      return c.json({ ok: true, data: serializeSharedChannel(existing as never, { includeConfig: true }) });
    }

    if (existing.type === 'wechat_ecloud') {
      const updated = (await db.channel.update({
        where: { id: existing.id },
        data: { status: 'disconnected' },
        select: sharedChannelSelect,
      })) as SharedChannelRow;

      return c.json({
        ok: true,
        data: serializeSharedChannel(updated as never, { includeConfig: true }),
      });
    }

    const client = new EvolutionApiClient();
    const config = parseWhatsAppEvolutionConfig(existing.config);
    try {
      await client.clearWebhook(config.instanceName);
    } catch {
      return c.json({ ok: false, error: 'evolution_webhook_clear_failed' }, 502);
    }

    let updated: SharedChannelRow;
    try {
      updated = (await db.channel.update({
        where: { id: existing.id },
        data: { status: 'disconnected' },
        select: sharedChannelSelect,
      })) as SharedChannelRow;
    } catch (error) {
      await rollbackEvolutionDisconnect(client, existing.id, config);
      throw error;
    }

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

    let rollbackConfig: WhatsAppEvolutionConfig | null = null;
    let client: EvolutionApiClient | null = null;
    if (existing.type === 'whatsapp_evolution' && existing.status === 'connected') {
      rollbackConfig = parseWhatsAppEvolutionConfig(existing.config);
      client = new EvolutionApiClient();
      try {
        await client.clearWebhook(rollbackConfig.instanceName);
      } catch {
        return c.json({ ok: false, error: 'evolution_webhook_clear_failed' }, 502);
      }
    }

    try {
      await db.channel.update({
        where: { id: existing.id },
        data: {
          status: 'archived',
          config: {},
        },
      });
    } catch (error) {
      if (client && rollbackConfig) {
        await rollbackEvolutionDisconnect(client, existing.id, rollbackConfig);
      }
      throw error;
    }

    return c.json({ ok: true, data: null });
  });
