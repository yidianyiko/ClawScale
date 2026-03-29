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
 *   6. Run the AI agent (with tenant persona + applicable workflows)
 *   7. Persist the assistant reply and return it to the channel adapter
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import OpenAI from 'openai';
import * as lineSdk from '@line/bot-sdk';
import { db } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { getLineBot, handleLineEvents } from '../adapters/line.js';
import { getTeamsBot, handleTeamsActivity } from '../adapters/teams.js';

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  return openai;
}

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
  // LINE webhook — verifies signature, then delegates to handleLineEvents.
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
  // Microsoft Teams Bot Framework webhook endpoint.
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
  // Called by platform-specific webhook adapters after they parse the raw payload.
  .post('/:channelId', zValidator('json', inboundSchema), async (c) => {
    const channelId = c.req.param('channelId');
    const body = c.req.valid('json');

    // 1. Resolve the channel and its tenant
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { id: true, tenantId: true, status: true },
    });

    if (!channel) return c.json({ ok: false, error: 'Channel not found' }, 404);
    if (channel.status !== 'connected') {
      return c.json({ ok: false, error: 'Channel is not connected' }, 503);
    }

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

    // 3. Find or create the EndUser
    let endUser = await db.endUser.findUnique({
      where: { tenantId_channelId_externalId: { tenantId, channelId, externalId: body.externalId } },
    });

    if (!endUser) {
      endUser = await db.endUser.create({
        data: {
          id: generateId('eu'),
          tenantId,
          channelId,
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

    if (endUser.status === 'blocked') {
      return c.json({ ok: false, error: 'Access denied' }, 403);
    }

    if (access === 'whitelist') {
      const allowed = settings.allowList ?? [];
      if (!allowed.includes(body.externalId)) {
        return c.json({ ok: false, error: 'Access denied' }, 403);
      }
    }

    if (access === 'blacklist') {
      const blocked = settings.blockList ?? [];
      if (blocked.includes(body.externalId)) {
        await db.endUser.update({ where: { id: endUser.id }, data: { status: 'blocked' } });
        return c.json({ ok: false, error: 'Access denied' }, 403);
      }
    }

    // 5. Find or create Conversation
    let conversation = await db.conversation.findFirst({
      where: { tenantId, channelId, endUserId: endUser.id },
    });

    if (!conversation) {
      conversation = await db.conversation.create({
        data: {
          id: generateId('conv'),
          tenantId,
          channelId,
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

    // 7. Load conversation history for context
    const history = await db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 50, // last 50 messages for context window
      select: { role: true, content: true },
    });

    // 8. Load active workflows for the tenant
    const workflows = await db.workflow.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, description: true, type: true },
    });

    // 9. Build AI context and generate reply
    // TODO: plug in the actual LLM call (Claude API, etc.)
    // For now, stub with a placeholder reply so the pipeline structure is in place.
    const replyText = await generateReply({
      personaName: settings.personaName ?? 'Assistant',
      personaPrompt: settings.personaPrompt ?? 'You are a helpful assistant.',
      history: history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      workflows,
    });

    // 10. Persist the assistant reply
    await db.message.create({
      data: {
        id: generateId('msg'),
        conversationId: conversation.id,
        role: 'assistant',
        content: replyText,
      },
    });

    // 11. Update conversation updatedAt
    await db.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return c.json({
      ok: true,
      data: {
        conversationId: conversation.id,
        reply: replyText,
      },
    });
  });

// ── AI generation ────────────────────────────────────────────────────────────
async function generateReply(ctx: {
  personaName: string;
  personaPrompt: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  workflows: { id: string; name: string; description?: string | null; type: string }[];
}): Promise<string> {
  const systemPrompt = ctx.workflows.length > 0
    ? `${ctx.personaPrompt}\n\nYou have access to the following workflows you can mention to users:\n${ctx.workflows.map((w) => `- ${w.name}${w.description ? ': ' + w.description : ''}`).join('\n')}`
    : ctx.personaPrompt;

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-5.4-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_completion_tokens: 4096,
  });

  const choice = response.choices[0];
  if (!choice?.message?.content?.trim()) {
    console.error('[ai] Empty response from model. finish_reason:', choice?.finish_reason, 'usage:', response.usage);
  }
  return choice?.message?.content?.trim() || 'Sorry, I could not generate a response.';
}
