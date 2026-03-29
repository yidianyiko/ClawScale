/**
 * Message Router
 *
 * Handles inbound messages from social channels (webhooks) and routes them
 * through the AI agent pipeline.
 *
 * Flow:
 *   1. Channel webhook → POST /gateway/:channelId
 *   2. Identify (or create) the EndUser by platform externalId
 *   3. Check end-user access policy (anonymous / whitelist / blacklist)
 *   4. Find or create a Conversation for this end-user on this channel
 *   5. Persist the inbound message
 *   6a. If the tenant has multiple active AI backends and the user hasn't
 *       picked one yet: send a selection menu and wait for their reply.
 *   6b. Once a backend is selected (or only one exists): route to that backend.
 *   7. Persist the assistant reply and return it to the channel adapter
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as lineSdk from '@line/bot-sdk';
import { db } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { generateReply } from '../lib/ai-backend.js';
import { getLineBot, handleLineEvents } from '../adapters/line.js';
import { getTeamsBot, handleTeamsActivity } from '../adapters/teams.js';
import type { AiBackendType, AiBackendProviderConfig } from '@clawscale/shared';

const inboundSchema = z.object({
  /** Platform-native user identifier (phone number, Telegram user_id, etc.) */
  externalId: z.string().min(1),
  /** Display name from the platform, if available */
  displayName: z.string().optional(),
  /** The text the user sent */
  text: z.string().min(1),
  /** Arbitrary metadata from the platform adapter */
  meta: z.record(z.unknown()).default({}),
});

export const gatewayRouter = new Hono()

  // ── POST /gateway/line/:channelId ────────────────────────────────────────────
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
  .post('/:channelId', zValidator('json', inboundSchema), async (c) => {
    const channelId = c.req.param('channelId');
    const body = c.req.valid('json');

    // 1. Resolve channel + tenant
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { id: true, tenantId: true, status: true },
    });

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    if (channel.status !== 'connected') return c.json({ ok: false, error: 'Channel is not connected' }, 503);

    const { tenantId } = channel;

    // 2. Load tenant settings (persona + access policy)
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const settings = (tenant?.settings ?? {}) as {
      personaName?: string;
      personaPrompt?: string;
      endUserAccess?: 'anonymous' | 'whitelist' | 'blacklist';
      allowList?: string[];
      blockList?: string[];
    };
    const personaName = settings.personaName ?? 'Assistant';
    const personaPrompt = settings.personaPrompt ?? 'You are a helpful assistant.';

    // 3. Find or create EndUser (with selectedBackendId)
    let endUser = await db.endUser.findUnique({
      where: { tenantId_channelId_externalId: { tenantId, channelId, externalId: body.externalId } },
    });

    if (!endUser) {
      endUser = await db.endUser.create({
        data: {
          id: generateId('eu'),
          tenantId, channelId,
          externalId: body.externalId,
          name: body.displayName ?? null,
          status: 'allowed',
        },
      });
    } else if (body.displayName && !endUser.name) {
      endUser = await db.endUser.update({
        where: { id: endUser.id },
        data: { name: body.displayName },
      });
    }

    // 4. Enforce access policy
    const access = settings.endUserAccess ?? 'anonymous';
    if (endUser.status === 'blocked') return c.json({ ok: false, error: 'Access denied' }, 403);
    if (access === 'whitelist' && !(settings.allowList ?? []).includes(body.externalId)) {
      return c.json({ ok: false, error: 'Access denied' }, 403);
    }
    if (access === 'blacklist' && (settings.blockList ?? []).includes(body.externalId)) {
      await db.endUser.update({ where: { id: endUser.id }, data: { status: 'blocked' } });
      return c.json({ ok: false, error: 'Access denied' }, 403);
    }

    // 5. Find or create Conversation
    let conversation = await db.conversation.findFirst({
      where: { tenantId, channelId, endUserId: endUser.id },
    });
    if (!conversation) {
      conversation = await db.conversation.create({
        data: {
          id: generateId('conv'),
          tenantId, channelId,
          endUserId: endUser.id,
        },
      });
    }

    // 6. Persist inbound message
    await db.message.create({
      data: {
        id: generateId('msg'),
        conversationId: conversation.id,
        role: 'user',
        content: body.text,
        metadata: body.meta,
      },
    });

    // 7. Load active AI backends for this tenant
    const backends = await db.aiBackend.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // 8. Resolve which backend to use
    let selectedBackendId = endUser.selectedBackendId;
    let replyText: string;

    if (backends.length === 0) {
      // No backends configured — fall back to env-level OpenAI
      replyText = await generateReply({ backend: undefined, systemPrompt: personaPrompt, history: await loadHistory(conversation.id) });

    } else if (backends.length === 1 && !selectedBackendId) {
      // Auto-select the only backend
      selectedBackendId = backends[0].id;
      endUser = await db.endUser.update({ where: { id: endUser.id }, data: { selectedBackendId } });
      await db.conversation.update({ where: { id: conversation.id }, data: { backendId: selectedBackendId } });
      replyText = await runBackend(backends[0], personaName, personaPrompt, conversation.id);

    } else if (!selectedBackendId) {
      // Multiple backends — check if user is replying to the selection menu
      const choice = parseInt(body.text.trim(), 10);
      if (!isNaN(choice) && choice >= 1 && choice <= backends.length) {
        // Valid choice — lock in the backend
        selectedBackendId = backends[choice - 1].id;
        endUser = await db.endUser.update({ where: { id: endUser.id }, data: { selectedBackendId } });
        await db.conversation.update({ where: { id: conversation.id }, data: { backendId: selectedBackendId } });
        replyText = `You're now connected to **${backends[choice - 1].name}**. How can I help you today?`;
      } else {
        // Show the selection menu
        replyText = buildSelectionMenu(personaName, backends);
      }

    } else {
      // User already has a selected backend
      const backend = backends.find((b) => b.id === selectedBackendId);
      if (!backend) {
        // Their previously selected backend was deleted — reset and show menu
        await db.endUser.update({ where: { id: endUser.id }, data: { selectedBackendId: null } });
        replyText = `Your previous AI assistant is no longer available.\n\n${buildSelectionMenu(personaName, backends)}`;
      } else {
        replyText = await runBackend(backend, personaName, personaPrompt, conversation.id);
      }
    }

    // 9. Persist assistant reply
    await db.message.create({
      data: {
        id: generateId('msg'),
        conversationId: conversation.id,
        role: 'assistant',
        content: replyText,
      },
    });

    await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    return c.json({ ok: true, data: { conversationId: conversation.id, reply: replyText } });
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSelectionMenu(
  personaName: string,
  backends: { id: string; name: string }[],
): string {
  const list = backends.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
  return `Hi! I'm ${personaName}. Which AI assistant would you like to use?\n\n${list}\n\nReply with a number to choose.`;
}

async function loadHistory(conversationId: string) {
  const msgs = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { role: true, content: true },
  });
  return msgs.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

async function runBackend(
  backend: { type: string; config: unknown },
  personaName: string,
  personaPrompt: string,
  conversationId: string,
): Promise<string> {
  const history = await loadHistory(conversationId);
  const workflows = await db.workflow.findMany({
    where: { tenantId: (await db.conversation.findUnique({ where: { id: conversationId }, select: { tenantId: true } }))!.tenantId, isActive: true },
    select: { name: true, description: true },
  });

  const systemPrompt = workflows.length > 0
    ? `${personaPrompt}\n\nYou have access to the following workflows:\n${workflows.map((w) => `- ${w.name}${w.description ? ': ' + w.description : ''}`).join('\n')}`
    : personaPrompt;

  const cfg = (backend.config ?? {}) as AiBackendProviderConfig;
  return generateReply({
    backend: { type: backend.type as AiBackendType, config: cfg },
    systemPrompt,
    history,
  });
}
