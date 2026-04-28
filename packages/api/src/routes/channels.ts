import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';
import { DEFAULT_COKE_AGENT_ID } from '../lib/platformization-migration.js';
import { startDiscordBot, stopDiscordBot } from '../adapters/discord.js';
import { startWeChatBot, stopWeChatBot } from '../adapters/wecom.js';
import { startWeixinBot, startWeixinQR, stopWeixinBot, getWeixinQR, getWeixinStatus } from '../adapters/wechat.js';
import { startWhatsAppBot, stopWhatsAppBot, getWhatsAppQR, getWhatsAppStatus } from '../adapters/whatsapp.js';
import { startWABusinessBot, stopWABusinessBot, reloadWABusinessBot } from '../adapters/whatsapp-business.js';
import { startTelegramBot, stopTelegramBot } from '../adapters/telegram.js';
import { startSlackBot, stopSlackBot } from '../adapters/slack.js';
import { startMatrixBot, stopMatrixBot } from '../adapters/matrix.js';
import { startLineBot, stopLineBot } from '../adapters/line.js';
import { startSignalBot, stopSignalBot } from '../adapters/signal.js';
import { startTeamsBot, stopTeamsBot } from '../adapters/teams.js';
import { ensureStoredWhatsAppEvolutionConfig } from '../lib/whatsapp-evolution-config.js';

const CHANNEL_TYPES = [
  'whatsapp', 'whatsapp_business', 'telegram', 'slack', 'discord', 'instagram',
  'facebook', 'line', 'signal', 'teams', 'matrix', 'web', 'wechat_work', 'whatsapp_evolution', 'wechat_personal',
] as const;

const createSchema = z.object({
  type: z.enum(CHANNEL_TYPES),
  name: z.string().min(1).max(80),
  config: z.record(z.unknown()).default({}),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  config: z.record(z.unknown()).optional(),
});

const evolutionConfigInputSchema = z.object({
  instanceName: z.string().trim().min(1),
}).strict();

const channelListSelect = {
  id: true,
  tenantId: true,
  type: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // config intentionally omitted (contains secrets)
} as const;

function validationError(issues: z.ZodIssue[]) {
  return {
    ok: false as const,
    error: 'validation_error',
    issues,
  };
}

export const channelsRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/channels ────────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db.channel.findMany({
      where: { tenantId },
      select: channelListSelect,
    });

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/channels ───────────────────────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const body = c.req.valid('json');

    if (body.type === 'wechat_personal') {
      return c.json({ ok: false, error: 'wechat_personal channels can only be managed through existing legacy rows' }, 400);
    }

    let config = body.config as Record<string, unknown>;
    if (body.type === 'whatsapp_evolution') {
      const parsedConfig = evolutionConfigInputSchema.safeParse(body.config);
      if (!parsedConfig.success) {
        return c.json(validationError(parsedConfig.error.issues), 400);
      }

      config = {
        instanceName: parsedConfig.data.instanceName,
        webhookToken: randomUUID(),
      };
    }

    const id = generateId('ch');
    await db.channel.create({
      data: {
        id,
        tenantId,
        type: body.type,
        name: body.name,
        config: config as any,
        status: 'disconnected',
        // Phase 1 keeps legacy tenant-level channel behavior while persisting dormant ownership metadata.
        ownershipKind: 'shared',
        agentId: DEFAULT_COKE_AGENT_ID,
        customerId: null,
      },
    });

    await audit({ tenantId, memberId: userId, action: 'create_channel', resource: 'channel', resourceId: id });

    const created = await db.channel.findUnique({ where: { id }, select: channelListSelect });
    return c.json({ ok: true, data: created }, 201);
  })

  // ── GET /api/channels/:id ────────────────────────────────────────────────────
  .get('/:id', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id')!;

    // Return config only on single-channel fetch (for editing)
    const channel = await db.channel.findFirst({ where: { id, tenantId } });

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    return c.json({ ok: true, data: channel });
  })

  // ── PATCH /api/channels/:id ──────────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id')!;
    const body = c.req.valid('json');

    const existing = await db.channel.findFirst({
      where: { id, tenantId },
      select: { id: true, type: true, status: true, config: true },
    });

    if (!existing) return c.json({ ok: false, error: 'Channel not found' }, 404);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      data.name = body.name;
    }
    if (body.config !== undefined) {
      if (existing.type === 'whatsapp_evolution') {
        if ('webhookToken' in body.config) {
          return c.json({ ok: false, error: 'webhook_token_not_mutable' }, 400);
        }

        const parsedConfig = evolutionConfigInputSchema.safeParse(body.config);
        if (!parsedConfig.success) {
          return c.json(validationError(parsedConfig.error.issues), 400);
        }

        const storedConfig = ensureStoredWhatsAppEvolutionConfig(existing.config, randomUUID);
        if (existing.status === 'connected' && parsedConfig.data.instanceName !== storedConfig.instanceName) {
          return c.json({ ok: false, error: 'disconnect_before_instance_change' }, 409);
        }

        data.config = {
          instanceName: parsedConfig.data.instanceName,
          webhookToken: storedConfig.webhookToken,
        };
      } else {
        data.config = body.config;
      }
    }

    await db.channel.update({ where: { id }, data: data as any });
    await audit({ tenantId, memberId: userId, action: 'update_channel', resource: 'channel', resourceId: id });

    // Reload in-memory config for adapters that cache it
    const full = await db.channel.findUnique({ where: { id } });
    if (full?.type === 'whatsapp_business') {
      reloadWABusinessBot(id).catch((err) =>
        console.error(`[wa-business:${id}] Failed to reload config:`, err),
      );
    }

    const updated = await db.channel.findUnique({ where: { id }, select: channelListSelect });
    return c.json({ ok: true, data: updated });
  })

  // ── DELETE /api/channels/:id ─────────────────────────────────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id')!;

    const existing = await db.channel.findFirst({ where: { id, tenantId } });
    if (!existing) return c.json({ ok: false, error: 'Channel not found' }, 404);

    if (existing.type === 'wechat_personal') {
      const liveStatus = getWeixinStatus(id);
      if (
        existing.status === 'pending' ||
        existing.status === 'connected' ||
        liveStatus === 'qr_pending' ||
        liveStatus === 'connected'
      ) {
        return c.json({ ok: false, error: 'disconnect_before_archive' }, 409);
      }
    }

    if (existing.type === 'discord') {
      stopDiscordBot(id).catch(() => {});
    } else if (existing.type === 'wechat_work') {
      stopWeChatBot(id).catch(() => {});
    } else if (existing.type === 'whatsapp') {
      stopWhatsAppBot(id).catch(() => {});
    } else if (existing.type === 'whatsapp_business') {
      stopWABusinessBot(id).catch(() => {});
    } else if (existing.type === 'telegram') {
      stopTelegramBot(id).catch(() => {});
    } else if (existing.type === 'slack') {
      stopSlackBot(id).catch(() => {});
    } else if (existing.type === 'matrix') {
      stopMatrixBot(id).catch(() => {});
    } else if (existing.type === 'line') {
      stopLineBot(id).catch(() => {});
    } else if (existing.type === 'signal') {
      stopSignalBot(id).catch(() => {});
    } else if (existing.type === 'teams') {
      stopTeamsBot(id).catch(() => {});
    }

    if (existing.type === 'wechat_personal') {
      await stopWeixinBot(id);
      await db.channel.update({
        where: { id },
        data: {
          status: 'archived',
          config: {},
          activeLifecycleKey: null,
        },
      });
      await audit({ tenantId, memberId: userId, action: 'archive_channel', resource: 'channel', resourceId: id });
      return c.json({ ok: true, data: null });
    }

    await db.channel.delete({ where: { id } });
    await audit({ tenantId, memberId: userId, action: 'delete_channel', resource: 'channel', resourceId: id });

    return c.json({ ok: true, data: null });
  })

  // ── POST /api/channels/:id/connect ──────────────────────────────────────────
  // Marks the channel active. The actual webhook listener is configured externally
  // on the platform-specific signed or tokenized /gateway route.
  .post('/:id/connect', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id')!;

    const channel = await db.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    if (channel.status === 'archived') {
      return c.json({ ok: false, error: 'archived_channel' }, 409);
    }
    if (channel.status === 'connected') {
      return c.json({ ok: true, data: { status: 'connected' } });
    }

    await db.channel.update({ where: { id }, data: { status: 'connected' } });
    await audit({ tenantId, memberId: userId, action: 'connect_channel', resource: 'channel', resourceId: id });

    // Start platform-specific adapter
    if (channel.type === 'discord') {
      const config = channel.config as Record<string, string> | null;
      const botToken = config?.['botToken'];
      if (botToken) {
        startDiscordBot(id, botToken).catch((err) =>
          console.error(`[discord:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'wechat_work') {
      const config = channel.config as Record<string, string> | null;
      const botId = config?.['botId'];
      const secret = config?.['secret'];
      if (botId && secret) {
        startWeChatBot(id, botId, secret).catch((err) =>
          console.error(`[wechat:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'wechat_personal') {
      await db.channel.update({ where: { id }, data: { status: 'pending' } });
      startWeixinQR(id).catch((err) =>
        console.error(`[weixin:${id}] Failed to start QR:`, err),
      );
      return c.json({ ok: true, data: { status: 'pending' } });
    } else if (channel.type === 'whatsapp') {
      // WhatsApp: start QR flow, status stays 'pending' until phone scans
      await db.channel.update({ where: { id }, data: { status: 'pending' } });
      startWhatsAppBot(id).catch((err) =>
        console.error(`[whatsapp:${id}] Failed to start bot:`, err),
      );
      return c.json({ ok: true, data: { status: 'pending' } });
    } else if (channel.type === 'whatsapp_business') {
      startWABusinessBot(id).catch((err) =>
        console.error(`[wa-business:${id}] Failed to start:`, err),
      );
    } else if (channel.type === 'telegram') {
      const config = channel.config as Record<string, string> | null;
      const botToken = config?.['botToken'];
      if (botToken) {
        startTelegramBot(id, botToken).catch((err) =>
          console.error(`[telegram:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'slack') {
      const config = channel.config as Record<string, string> | null;
      const botToken = config?.['botToken'];
      const appToken = config?.['appToken'];
      if (botToken && appToken) {
        startSlackBot(id, botToken, appToken).catch((err) =>
          console.error(`[slack:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'matrix') {
      const config = channel.config as Record<string, string> | null;
      const homeserverUrl = config?.['homeserverUrl'];
      const accessToken = config?.['accessToken'];
      if (homeserverUrl && accessToken) {
        startMatrixBot(id, homeserverUrl, accessToken).catch((err) =>
          console.error(`[matrix:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'line') {
      const config = channel.config as Record<string, string> | null;
      const channelAccessToken = config?.['channelAccessToken'];
      const channelSecret = config?.['channelSecret'];
      if (channelAccessToken && channelSecret) {
        startLineBot(id, channelAccessToken, channelSecret).catch((err) =>
          console.error(`[line:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'signal') {
      const config = channel.config as Record<string, string> | null;
      const phoneNumber = config?.['phoneNumber'];
      const signalCliUrl = config?.['signalCliUrl'] ?? 'http://localhost:8080';
      if (phoneNumber) {
        startSignalBot(id, phoneNumber, signalCliUrl).catch((err) =>
          console.error(`[signal:${id}] Failed to start bot:`, err),
        );
      }
    } else if (channel.type === 'teams') {
      const config = channel.config as Record<string, string> | null;
      const appId = config?.['appId'];
      const appPassword = config?.['appPassword'];
      if (appId && appPassword) {
        startTeamsBot(id, appId, appPassword).catch((err) =>
          console.error(`[teams:${id}] Failed to start bot:`, err),
        );
      }
    }

    return c.json({ ok: true, data: { status: 'connected' } });
  })

  // ── POST /api/channels/:id/disconnect ───────────────────────────────────────
  .post('/:id/disconnect', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id')!;

    const channel = await db.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    if (channel.status === 'archived') {
      return c.json({ ok: false, error: 'archived_channel' }, 409);
    }

    await db.channel.update({ where: { id }, data: { status: 'disconnected' } });
    await audit({ tenantId, memberId: userId, action: 'disconnect_channel', resource: 'channel', resourceId: id });

    // Stop platform-specific adapter
    if (channel.type === 'discord') {
      stopDiscordBot(id).catch((err) =>
        console.error(`[discord:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'wechat_work') {
      stopWeChatBot(id).catch((err) =>
        console.error(`[wechat:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'wechat_personal') {
      stopWeixinBot(id).catch((err) =>
        console.error(`[weixin:${id}] Failed to stop:`, err),
      );
    } else if (channel.type === 'whatsapp') {
      stopWhatsAppBot(id).catch((err) =>
        console.error(`[whatsapp:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'whatsapp_business') {
      stopWABusinessBot(id).catch((err) =>
        console.error(`[wa-business:${id}] Failed to stop:`, err),
      );
    } else if (channel.type === 'telegram') {
      stopTelegramBot(id).catch((err) =>
        console.error(`[telegram:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'slack') {
      stopSlackBot(id).catch((err) =>
        console.error(`[slack:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'matrix') {
      stopMatrixBot(id).catch((err) =>
        console.error(`[matrix:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'line') {
      stopLineBot(id).catch((err) =>
        console.error(`[line:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'signal') {
      stopSignalBot(id).catch((err) =>
        console.error(`[signal:${id}] Failed to stop bot:`, err),
      );
    } else if (channel.type === 'teams') {
      stopTeamsBot(id).catch((err) =>
        console.error(`[teams:${id}] Failed to stop bot:`, err),
      );
    }

    return c.json({ ok: true, data: { status: 'disconnected' } });
  })

  // ── GET /api/channels/:id/qr ─────────────────────────────────────────────────
  // Poll this endpoint after connecting a WhatsApp channel to get the QR code.
  .get('/:id/qr', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id')!;

    const channel = await db.channel.findFirst({
      where: { id, tenantId },
      select: { id: true, type: true, status: true },
    });
    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    if (channel.type !== 'whatsapp' && channel.type !== 'wechat_personal') {
      return c.json({ ok: false, error: 'Channel does not support QR login' }, 400);
    }

    if (channel.type === 'wechat_personal') {
      if (channel.status === 'pending' && getWeixinStatus(id) == null) {
        await startWeixinQR(id);
      }

      let qr = getWeixinQR(id);
      if (!qr && getWeixinStatus(id) === 'qr_pending') {
        await new Promise<void>((resolve) => {
          const deadline = Date.now() + 35_000;
          const check = setInterval(() => {
            qr = getWeixinQR(id);
            if (qr || Date.now() > deadline) { clearInterval(check); resolve(); }
          }, 300);
        });
      }
      const status = getWeixinStatus(id);
      return c.json({ ok: true, data: { qr: qr?.image ?? null, qrUrl: qr?.url ?? null, status } });
    }

    // Wait up to 10s for QR to be ready if not yet available
    let qr = getWhatsAppQR(id);
    if (!qr && getWhatsAppStatus(id) === 'qr_pending') {
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 10_000;
        const check = setInterval(() => {
          qr = getWhatsAppQR(id);
          if (qr || Date.now() > deadline) { clearInterval(check); resolve(); }
        }, 300);
      });
    }

    const status = getWhatsAppStatus(id);
    return c.json({ ok: true, data: { qr: qr?.image ?? null, qrUrl: qr?.url ?? null, status } });
  });
