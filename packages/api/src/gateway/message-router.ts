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
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import { EvolutionApiClient } from '../lib/evolution-api.js';
import { normalizeInboundAttachments } from '../lib/inbound-attachments.js';
import { getLineBot, handleLineEvents } from '../adapters/line.js';
import { getTeamsBot, handleTeamsActivity } from '../adapters/teams.js';
import { verifyWebhook, handleWABusinessWebhook } from '../adapters/whatsapp-business.js';

const inboundSchema = z.object({
  externalId: z.string().min(1),
  displayName: z.string().optional(),
  text: z.string().default(''),
  attachments: z.array(z.unknown()).optional(),
  meta: z.record(z.unknown()).default({}),
});

interface EvolutionMediaMessage {
  url?: unknown;
  caption?: unknown;
  mimetype?: unknown;
  fileLength?: unknown;
  fileName?: unknown;
  filename?: unknown;
  title?: unknown;
}

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
    imageMessage?: EvolutionMediaMessage;
    audioMessage?: EvolutionMediaMessage;
    videoMessage?: EvolutionMediaMessage;
    documentMessage?: EvolutionMediaMessage;
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

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readFiniteSize(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

function hasDataUrlAttachment(rawAttachments: unknown): boolean {
  if (!Array.isArray(rawAttachments)) return false;

  return rawAttachments.some((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const url = (raw as Record<string, unknown>)['url'];
    return typeof url === 'string' && /^data:/i.test(url.trim());
  });
}

function readEvolutionText(data: EvolutionWebhookData): string {
  const conversation = data.message?.conversation?.trim();
  if (conversation) {
    return conversation;
  }

  const extendedText = data.message?.extendedTextMessage?.text?.trim();
  if (extendedText) {
    return extendedText;
  }

  const imageCaption = data.message?.imageMessage?.caption;
  if (typeof imageCaption === 'string' && imageCaption.trim()) {
    return imageCaption.trim();
  }

  const videoCaption = data.message?.videoMessage?.caption;
  if (typeof videoCaption === 'string' && videoCaption.trim()) {
    return videoCaption.trim();
  }

  const documentCaption = data.message?.documentMessage?.caption;
  if (typeof documentCaption === 'string' && documentCaption.trim()) {
    return documentCaption.trim();
  }

  return '';
}

function readEvolutionAttachments(data: EvolutionWebhookData): unknown[] {
  const message = data.message;
  if (!message) return [];

  const mediaMessages = [
    message.imageMessage,
    message.audioMessage,
    message.videoMessage,
    message.documentMessage,
  ];

  return mediaMessages.flatMap((media) => {
    const url = readNonEmptyString(media?.url);
    if (!url) return [];

    const filename =
      readNonEmptyString(media?.fileName) ??
      readNonEmptyString(media?.filename) ??
      readNonEmptyString(media?.title);
    const contentType = readNonEmptyString(media?.mimetype);
    const size = readFiniteSize(media?.fileLength);

    return [
      {
        url,
        ...(filename ? { filename } : {}),
        ...(contentType ? { contentType } : {}),
        ...(size !== undefined ? { size } : {}),
      },
    ];
  });
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
    const attachmentResult = normalizeInboundAttachments(readEvolutionAttachments(data), {
      allowDataUrls: false,
    });
    if (attachmentResult.rejected) {
      return c.json({ ok: true });
    }
    const attachments = attachmentResult.attachments;
    if (!text.trim() && attachments.length === 0) {
      return c.json({ ok: true });
    }

    try {
      const result = await routeInboundMessage({
        channelId,
        externalId: normalizeEvolutionExternalId(remoteJid),
        displayName: data.pushName,
        text,
        ...(attachments.length
          ? {
              attachments,
              attachmentPolicy: { allowDataUrls: false },
            }
          : {}),
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
    if (hasDataUrlAttachment(body.attachments)) {
      return c.json({ ok: false, error: 'Invalid attachments' }, 400);
    }

    const attachmentResult = normalizeInboundAttachments(body.attachments, {
      allowDataUrls: false,
    });
    if (attachmentResult.rejected) {
      return c.json({ ok: false, error: 'Invalid attachments' }, 400);
    }

    const attachments = attachmentResult.attachments;
    if (!body.text.trim() && attachments.length === 0) {
      return c.json({ ok: false, error: 'Message text or attachment is required' }, 400);
    }

    const result = await routeInboundMessage({
      channelId,
      externalId: body.externalId,
      displayName: body.displayName,
      text: body.text,
      ...(attachments.length
        ? {
            attachments,
            attachmentPolicy: { allowDataUrls: false },
          }
        : {}),
      meta: body.meta,
    });

    if (!result) return c.json({ ok: false, error: 'Message could not be routed' }, 400);
    return c.json({ ok: true, data: result });
  });
