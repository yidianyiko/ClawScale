/**
 * Message Router (HTTP gateway)
 *
 * Thin HTTP layer over routeInboundMessage(). All channel adapters call
 * routeInboundMessage() directly — these routes exist for webhook-based
 * platforms (LINE, Teams) that need HTTP signature verification before
 * the message can be handed off.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as lineSdk from '@line/bot-sdk';
import type { Prisma } from '@prisma/client';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import { EvolutionApiClient } from '../lib/evolution-api.js';
import { WechatEcloudApiClient } from '../lib/wechat-ecloud-api.js';
import { parseStoredWechatEcloudConfig } from '../lib/wechat-ecloud-config.js';
import {
  normalizeWechatEcloudWebhook,
  timingSafeEqualString,
} from '../lib/wechat-ecloud-webhook.js';
import { getLineBot, handleLineEvents } from '../adapters/line.js';
import { getTeamsBot, handleTeamsActivity } from '../adapters/teams.js';
import { verifyWebhook, handleWABusinessWebhook } from '../adapters/whatsapp-business.js';

const inboundSchema = z.object({
  externalId: z.string().min(1),
  displayName: z.string().optional(),
  text: z.string().min(1),
  meta: z.record(z.unknown()).default({}),
});

interface EvolutionWebhookData {
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
  };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
    };
  };
  messageType?: string;
}

interface EvolutionWebhookConfigSnapshot {
  webhookToken: string | null;
  instanceName: string | null;
}

function readEvolutionWebhookData(payload: unknown): EvolutionWebhookData | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  return data as EvolutionWebhookData;
}

function readEvolutionWebhookConfig(config: unknown): EvolutionWebhookConfigSnapshot {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      webhookToken: null,
      instanceName: null,
    };
  }

  const record = config as Record<string, unknown>;
  const webhookToken =
    typeof record['webhookToken'] === 'string' && record['webhookToken'].trim()
      ? record['webhookToken'].trim()
      : null;
  const instanceName =
    typeof record['instanceName'] === 'string' && record['instanceName'].trim()
      ? record['instanceName'].trim()
      : null;

  return {
    webhookToken,
    instanceName,
  };
}

function shouldIgnoreEvolutionRemoteJid(remoteJid: string): boolean {
  return (
    remoteJid === '' ||
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('@broadcast') ||
    remoteJid === 'status@broadcast'
  );
}

function normalizeEvolutionExternalId(remoteJid: string): string {
  const digitsOnly = remoteJid.replace(/\D+/g, '');
  return digitsOnly || remoteJid;
}

function readEvolutionText(data: EvolutionWebhookData): string | null {
  const conversation = data.message?.conversation?.trim();
  if (conversation) {
    return conversation;
  }

  const extendedText = data.message?.extendedTextMessage?.text?.trim();
  return extendedText || null;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
}

export const gatewayRouter = new Hono()

  // ── GET /gateway/whatsapp/:channelId ────────────────────────────────────────
  // Meta webhook verification — responds with hub.challenge.
  .get('/whatsapp/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    const mode = c.req.query('hub.mode') ?? '';
    const token = c.req.query('hub.verify_token') ?? '';
    const challenge = c.req.query('hub.challenge') ?? '';

    const result = await verifyWebhook(channelId, mode, token, challenge);
    if (result) return c.text(result, 200);
    return c.json({ ok: false, error: 'Verification failed' }, 403);
  })

  // ── POST /gateway/whatsapp/:channelId ───────────────────────────────────────
  // Meta sends inbound WhatsApp Business messages here.
  .post('/whatsapp/:channelId', async (c) => {
    const channelId = c.req.param('channelId');

    const body = await c.req.json();
    handleWABusinessWebhook(channelId, body).catch((err) =>
      console.error(`[wa-business:${channelId}] Webhook handling error:`, err),
    );

    // Always return 200 quickly so Meta doesn't retry
    return c.json({ ok: true });
  })

  // ── POST /gateway/evolution/whatsapp/:channelId/:token ─────────────────────
  // Evolution sends shared-channel WhatsApp events here.
  .post('/evolution/whatsapp/:channelId/:token', async (c) => {
    const channelId = c.req.param('channelId');
    const token = c.req.param('token');

    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        type: true,
        status: true,
        config: true,
      },
    });

    if (!channel || channel.type !== 'whatsapp_evolution' || channel.status !== 'connected') {
      return c.json({ ok: false, error: 'Channel not found or not connected' }, 404);
    }

    const channelConfig = readEvolutionWebhookConfig(channel.config);
    if (!channelConfig.webhookToken || token !== channelConfig.webhookToken) {
      return c.json({ ok: false, error: 'Forbidden' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const data = readEvolutionWebhookData(body);
    if (!data) {
      return c.json({ ok: true });
    }

    const remoteJid = data.key?.remoteJid?.trim() ?? '';
    if (data.key?.fromMe || shouldIgnoreEvolutionRemoteJid(remoteJid)) {
      return c.json({ ok: true });
    }

    const text = readEvolutionText(data);
    if (!text) {
      return c.json({ ok: true });
    }

    try {
      const result = await routeInboundMessage({
        channelId,
        externalId: normalizeEvolutionExternalId(remoteJid),
        displayName: data.pushName,
        text,
        meta: {
          platform: 'whatsapp_evolution',
          instanceName: channelConfig.instanceName,
          messageId: data.key?.id,
          messageType: data.messageType,
          remoteJid,
        },
      });

      if (result?.reply && channelConfig.instanceName) {
        await new EvolutionApiClient().sendText(
          channelConfig.instanceName,
          normalizeEvolutionExternalId(remoteJid),
          result.reply,
        );
      }
    } catch (err) {
      console.error(`[evolution:${channelId}] Webhook handling error:`, err);
    }

    return c.json({ ok: true });
  })

  // ── POST /gateway/ecloud/wechat/:channelId/:token ──────────────────────────
  // Ecloud sends shared-channel private WeChat callbacks here.
  .post('/ecloud/wechat/:channelId/:token', async (c) => {
    const channelId = c.req.param('channelId');
    const token = c.req.param('token');

    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        type: true,
        status: true,
        config: true,
      },
    });

    if (!channel || channel.type !== 'wechat_ecloud' || channel.status !== 'connected') {
      return c.json({ ok: false, error: 'Channel not found or not connected' }, 404);
    }

    let config: ReturnType<typeof parseStoredWechatEcloudConfig>;
    try {
      config = parseStoredWechatEcloudConfig(channel.config);
    } catch (error) {
      console.error(`[ecloud:${channelId}] Invalid stored config:`, error);
      return c.json({ ok: false, error: 'Channel not found or not connected' }, 404);
    }

    if (!timingSafeEqualString(token, config.webhookToken)) {
      return c.json({ ok: false, error: 'Forbidden' }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (body == null) {
      return c.json({ ok: true });
    }

    const decision = normalizeWechatEcloudWebhook(body, config.appId);
    if (decision.kind === 'ignore') {
      return c.json({ ok: true });
    }

    try {
      await db.inboundWebhookReceipt.create({
        data: {
          channelId,
          provider: 'wechat_ecloud',
          idempotencyKey: `${channelId}:${decision.receiptKey}`,
          payload: body as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return c.json({ ok: true });
      }

      console.error(`[ecloud:${channelId}] Receipt handling error:`, {
        error,
        receiptKey: decision.receiptKey,
        msgId: decision.meta['msgId'],
        newMsgId: decision.meta['newMsgId'],
      });
      return c.json({ ok: true });
    }

    try {
      const result = await routeInboundMessage({
        channelId,
        externalId: decision.externalId,
        displayName: decision.displayName,
        text: decision.text,
        meta: decision.meta,
      });

      if (result?.reply) {
        await new WechatEcloudApiClient(config.baseUrl, config.token).sendText(
          config.appId,
          decision.externalId,
          result.reply,
        );
      }
    } catch (error) {
      console.error(`[ecloud:${channelId}] Webhook handling error:`, {
        error,
        receiptKey: decision.receiptKey,
        msgId: decision.meta['msgId'],
        newMsgId: decision.meta['newMsgId'],
      });
    }

    return c.json({ ok: true });
  })

  // ── POST /gateway/line/:channelId ────────────────────────────────────────────
  // LINE webhook — verifies signature, then delegates to the LINE adapter.
  .post('/line/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    const bot = getLineBot(channelId);
    if (!bot) return c.json({ ok: false, error: 'Channel not found or not connected' }, 404);

    const signature = c.req.header('x-line-signature') ?? '';
    const body = await c.req.text();

    if (!lineSdk.validateSignature(body, bot.channelSecret, signature)) {
      return c.json({ ok: false, error: 'Invalid signature' }, 400);
    }

    const payload = JSON.parse(body) as { events: lineSdk.WebhookEvent[] };
    handleLineEvents(channelId, payload.events).catch((err) =>
      console.error(`[line:${channelId}] Event handling error:`, err),
    );

    return c.json({ ok: true });
  })

  // ── POST /gateway/teams/:channelId ───────────────────────────────────────────
  // Teams webhook — delegates to the Teams adapter for JWT verification + reply.
  .post('/teams/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    const bot = getTeamsBot(channelId);
    if (!bot) return c.json({ ok: false, error: 'Channel not found or not connected' }, 404);

    const activity = await c.req.json();
    handleTeamsActivity(channelId, activity).catch((err) =>
      console.error(`[teams:${channelId}] Activity handling error:`, err),
    );

    return c.json({ ok: true });
  })

  // ── POST /gateway/:channelId ─────────────────────────────────────────────────
  // Generic inbound endpoint — used by adapters that do their own event handling
  // but still want an HTTP interface (useful for testing / external integrations).
  .post('/:channelId', zValidator('json', inboundSchema), async (c) => {
    const channelId = c.req.param('channelId');
    const body = c.req.valid('json');

    const result = await routeInboundMessage({
      channelId,
      externalId: body.externalId,
      displayName: body.displayName,
      text: body.text,
      meta: body.meta,
    });

    if (!result) return c.json({ ok: false, error: 'Message could not be routed' }, 400);
    return c.json({ ok: true, data: result });
  });
