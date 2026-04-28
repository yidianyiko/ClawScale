/**
 * Message Router (HTTP gateway)
 *
 * Thin HTTP layer over routeInboundMessage() for shared-channel webhooks
 * owned by the gateway.
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import { EvolutionApiClient } from '../lib/evolution-api.js';
import { LinqApiClient } from '../lib/linq-api.js';
import { normalizeLinqPhoneNumber, parseStoredLinqConfig } from '../lib/linq-config.js';
import { WechatEcloudApiClient } from '../lib/wechat-ecloud-api.js';
import { parseStoredWechatEcloudConfig } from '../lib/wechat-ecloud-config.js';
import {
  normalizeWechatEcloudWebhook,
  timingSafeEqualString,
} from '../lib/wechat-ecloud-webhook.js';
import { normalizeInboundAttachments } from '../lib/inbound-attachments.js';

const LINQ_REPLAY_WINDOW_SECONDS = 300;

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

interface LinqWebhookConfigSnapshot {
  fromNumber: string;
  webhookToken: string;
  webhookSubscriptionId: string;
  signingSecret: string;
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

function looksLikeDataUrl(value: string): boolean {
  return /^data:/i.test(value.replace(/[\u0000-\u001f\u007f]/g, '').trim());
}

function hasDataUrlAttachment(rawAttachments: unknown): boolean {
  if (!Array.isArray(rawAttachments)) return false;

  return rawAttachments.some((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const url = (raw as Record<string, unknown>)['url'];
    return typeof url === 'string' && looksLikeDataUrl(url);
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

  const audioCaption = data.message?.audioMessage?.caption;
  if (typeof audioCaption === 'string' && audioCaption.trim()) {
    return audioCaption.trim();
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

function readEvolutionMediaMessages(data: EvolutionWebhookData): EvolutionMediaMessage[] {
  const message = data.message;
  if (!message) return [];

  return [
    message.imageMessage,
    message.audioMessage,
    message.videoMessage,
    message.documentMessage,
  ].filter((media): media is EvolutionMediaMessage => Boolean(media));
}

function hasEvolutionDataUrlMedia(data: EvolutionWebhookData): boolean {
  return readEvolutionMediaMessages(data).some((media) => {
    const url = readNonEmptyString(media.url);
    return url ? looksLikeDataUrl(url) : false;
  });
}

function readEvolutionAttachments(data: EvolutionWebhookData): unknown[] {
  return readEvolutionMediaMessages(data).flatMap((media) => {
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

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
}

function readConnectedLinqWebhookConfig(config: unknown): LinqWebhookConfigSnapshot | null {
  try {
    const parsed = parseStoredLinqConfig(config);
    if (!parsed.webhookToken || !parsed.webhookSubscriptionId || !parsed.signingSecret) {
      return null;
    }

    return {
      fromNumber: parsed.fromNumber,
      webhookToken: parsed.webhookToken,
      webhookSubscriptionId: parsed.webhookSubscriptionId,
      signingSecret: parsed.signingSecret,
    };
  } catch {
    return null;
  }
}

function verifyLinqSignature(params: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  signingSecret: string;
}): boolean {
  const timestamp = params.timestamp?.trim() ?? '';
  const signature = params.signature?.trim() ?? '';
  if (!timestamp || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNumber) > LINQ_REPLAY_WINDOW_SECONDS) {
    return false;
  }

  const expected = createHmac('sha256', params.signingSecret)
    .update(`${timestamp}.${params.rawBody}`)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return readRecord(record[key]);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNestedString(record: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = record;
  for (const key of path) {
    const currentRecord = readRecord(current);
    if (!currentRecord) {
      return null;
    }
    current = currentRecord[key];
  }

  return readString(current);
}

function readLinqSenderHandle(data: Record<string, unknown>): string | null {
  return (
    readNestedString(data, ['sender_handle', 'handle']) ??
    readNestedString(data, ['from_handle', 'handle']) ??
    readString(data['from'])
  );
}

function readLinqText(data: Record<string, unknown>): string | null {
  const message = readNestedRecord(data, 'message');
  const parts = Array.isArray(data['parts'])
    ? data['parts']
    : message && Array.isArray(message['parts'])
      ? message['parts']
      : [];
  const textParts = parts
    .map((part) => {
      const record = readRecord(part);
      if (!record || record['type'] !== 'text') {
        return null;
      }

      return readString(record['value']) ?? readString(record['text']);
    })
    .filter((text): text is string => Boolean(text));
  const text = textParts.join('\n').trim();
  return text || null;
}

function readLinqStringMeta(payload: Record<string, unknown>, data: Record<string, unknown>) {
  const message = readNestedRecord(data, 'message');
  const chat = readNestedRecord(data, 'chat');
  return {
    eventId: readString(payload['event_id']) ?? readString(payload['id']),
    chatId: (chat && readString(chat['id'])) ?? readString(data['chat_id']),
    messageId:
      (message && readString(message['id'])) ??
      readString(data['message_id']) ??
      readString(data['id']),
    service: readString(data['service']),
    ownerHandle: readNestedString(data, ['chat', 'owner_handle', 'handle']),
  };
}

export const gatewayRouter = new Hono()
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
    if (hasEvolutionDataUrlMedia(data)) {
      return c.json({ ok: true });
    }

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
      return c.json({ ok: false, error: 'receipt_persist_failed' }, 503);
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

  // ── POST /gateway/linq/:channelId/:token ───────────────────────────────────
  // Linq shared-channel webhook — verifies HMAC before parsing JSON payloads.
  .post('/linq/:channelId/:token', async (c) => {
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

    if (!channel || channel.type !== 'linq' || channel.status !== 'connected') {
      return c.json({ ok: false, error: 'Forbidden' }, 403);
    }

    const channelConfig = readConnectedLinqWebhookConfig(channel.config);
    if (!channelConfig || token !== channelConfig.webhookToken) {
      return c.json({ ok: false, error: 'Forbidden' }, 403);
    }

    const subscriptionId = c.req.header('X-Webhook-Subscription-ID')?.trim();
    if (!subscriptionId || subscriptionId !== channelConfig.webhookSubscriptionId) {
      return c.json({ ok: false, error: 'Forbidden' }, 403);
    }

    const rawBody = await c.req.text();
    if (
      !verifyLinqSignature({
        rawBody,
        timestamp: c.req.header('X-Webhook-Timestamp'),
        signature: c.req.header('X-Webhook-Signature'),
        signingSecret: channelConfig.signingSecret,
      })
    ) {
      return c.json({ ok: false, error: 'Forbidden' }, 403);
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawBody) as unknown;
    } catch {
      return c.json({ ok: true });
    }

    const payload = readRecord(parsedPayload);
    if (!payload || payload['event_type'] !== 'message.received') {
      return c.json({ ok: true });
    }

    const data = readRecord(payload['data']);
    if (!data || data['direction'] === 'outbound' || data['is_from_me'] === true) {
      return c.json({ ok: true });
    }

    const senderHandle = readLinqSenderHandle(data);
    if (!senderHandle) {
      return c.json({ ok: true });
    }

    let normalizedSender: string;
    try {
      normalizedSender = normalizeLinqPhoneNumber(senderHandle);
    } catch {
      return c.json({ ok: true });
    }

    const text = readLinqText(data);
    if (!text) {
      return c.json({ ok: true });
    }

    try {
      const meta = readLinqStringMeta(payload, data);
      const result = await routeInboundMessage({
        channelId,
        externalId: normalizedSender,
        displayName: senderHandle,
        text,
        meta: {
          platform: 'linq',
          eventId: meta.eventId,
          chatId: meta.chatId,
          messageId: meta.messageId,
          service: meta.service,
          ownerHandle: meta.ownerHandle,
          webhookSubscriptionId: channelConfig.webhookSubscriptionId,
        },
      });

      if (result?.reply) {
        await new LinqApiClient().createChat({
          from: channelConfig.fromNumber,
          to: [normalizedSender],
          text: result.reply,
        });
      }
    } catch (err) {
      console.error(`[linq:${channelId}] Webhook handling error:`, err);
    }

    return c.json({ ok: true });
  });
