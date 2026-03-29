/**
 * routeInboundMessage — central message routing function.
 *
 * All channel adapters call this directly. It handles:
 *   - EndUser creation / lookup
 *   - Access policy enforcement
 *   - Conversation management
 *   - Message persistence
 *   - AI backend selection (multi-backend: users can have many active)
 *   - Reply generation and persistence (one reply per active backend)
 */

import { db } from '../db/index.js';
import { generateId } from './id.js';
import { generateReply } from './ai-backend.js';
import { clawscaleAgent, buildSelectionMenu } from './clawscale-agent.js';
import type { AiBackendType, AiBackendProviderConfig } from '@clawscale/shared';

export interface InboundMessage {
  channelId: string;
  externalId: string;
  displayName?: string;
  text: string;
  meta?: Record<string, unknown>;
}

export interface ReplyEntry {
  backendId: string | null;
  backendName: string | null;
  reply: string;
}

export interface RouteResult {
  conversationId: string;
  /** All replies generated for this message (one per active backend, plus optional ClawScale reply). */
  replies: ReplyEntry[];
  /** @deprecated Use replies[0].reply for backwards compat with single-reply adapters */
  reply: string;
}

export async function routeInboundMessage(input: InboundMessage): Promise<RouteResult | null> {
  const { channelId, externalId, displayName, text, meta } = input;

  // 1. Resolve channel + tenant
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, tenantId: true, status: true },
  });

  if (!channel || channel.status !== 'connected') return null;

  const { tenantId } = channel;

  // 2. Load tenant settings (persona + access policy)
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const settings = (tenant?.settings ?? {}) as {
    personaName?: string;
    endUserAccess?: 'anonymous' | 'whitelist' | 'blacklist';
    allowList?: string[];
    clawscale?: { name?: string; answerStyle?: string; isActive?: boolean };
    blockList?: string[];
  };
  const personaName = settings.personaName ?? 'Assistant';

  // 3. Find or create EndUser
  let endUser = await db.endUser.findUnique({
    where: { tenantId_channelId_externalId: { tenantId, channelId, externalId } },
    include: { activeBackends: { select: { backendId: true } } },
  });

  if (!endUser) {
    endUser = await db.endUser.create({
      data: {
        id: generateId('eu'),
        tenantId, channelId, externalId,
        name: displayName ?? null,
        status: 'allowed',
      },
      include: { activeBackends: { select: { backendId: true } } },
    });
  } else if (displayName && !endUser.name) {
    endUser = await db.endUser.update({
      where: { id: endUser.id },
      data: { name: displayName },
      include: { activeBackends: { select: { backendId: true } } },
    });
  }

  const activeBackendIds = endUser.activeBackends.map((ab) => ab.backendId);

  // 4. Enforce access policy
  const access = settings.endUserAccess ?? 'anonymous';
  if (endUser.status === 'blocked') return null;
  if (access === 'whitelist' && !(settings.allowList ?? []).includes(externalId)) return null;
  if (access === 'blacklist' && (settings.blockList ?? []).includes(externalId)) {
    await db.endUser.update({ where: { id: endUser.id }, data: { status: 'blocked' } });
    return null;
  }

  // 5. Find or create Conversation
  let conversation = await db.conversation.findFirst({
    where: { tenantId, channelId, endUserId: endUser.id },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { id: generateId('conv'), tenantId, channelId, endUserId: endUser.id },
    });
  }

  // 6. Persist inbound message
  await db.message.create({
    data: {
      id: generateId('msg'),
      conversationId: conversation.id,
      role: 'user',
      content: text,
      metadata: meta ?? {},
    },
  });

  // 7. Load backends and ClawScale orchestrator config
  const clawscaleCfg = settings.clawscale ?? {};
  const clawscaleName = clawscaleCfg.name ?? 'ClawScale Assistant';
  const clawscaleStyle = clawscaleCfg.answerStyle;
  const clawscaleActive = clawscaleCfg.isActive !== false;

  const allBackends = await db.aiBackend.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  // 8. Run ClawScale agent for selection commands / knowledge / menu
  const replies: ReplyEntry[] = [];

  // Always run ClawScale agent first to check for selection commands
  if (clawscaleActive) {
    const agentResponse = clawscaleAgent(
      text,
      allBackends.map((b) => ({ id: b.id, name: b.name })),
      activeBackendIds,
      clawscaleName,
      'select',
      clawscaleStyle,
    );

    // Process add/remove commands
    if (agentResponse.addBackendIds?.length) {
      for (const bid of agentResponse.addBackendIds) {
        await db.endUserBackend.upsert({
          where: { endUserId_backendId: { endUserId: endUser.id, backendId: bid } },
          create: { endUserId: endUser.id, backendId: bid },
          update: {},
        });
        if (!activeBackendIds.includes(bid)) activeBackendIds.push(bid);
      }
    }
    if (agentResponse.removeBackendIds?.length) {
      await db.endUserBackend.deleteMany({
        where: {
          endUserId: endUser.id,
          backendId: { in: agentResponse.removeBackendIds },
        },
      });
      for (const bid of agentResponse.removeBackendIds) {
        const idx = activeBackendIds.indexOf(bid);
        if (idx !== -1) activeBackendIds.splice(idx, 1);
      }
    }

    // If ClawScale has a non-empty reply (menu, knowledge, selection confirmation), include it
    if (agentResponse.reply) {
      replies.push({ backendId: null, backendName: clawscaleName, reply: agentResponse.reply });
      await db.message.create({
        data: {
          id: generateId('msg'),
          conversationId: conversation.id,
          role: 'assistant',
          content: agentResponse.reply,
          backendId: null,
        },
      });
    }

    // If the agent handled a selection command, return early (don't also route to backends)
    if (agentResponse.addBackendIds?.length || agentResponse.removeBackendIds?.length) {
      await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      const combinedReply = replies.map((r) => r.reply).join('\n\n');
      return { conversationId: conversation.id, replies, reply: combinedReply };
    }
  }

  // 9. Route to active backends
  const activeBackends = allBackends.filter((b) => activeBackendIds.includes(b.id));

  if (activeBackends.length === 0) {
    // No active backends — if ClawScale already replied (menu/knowledge), we're done
    if (replies.length > 0) {
      await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      const combinedReply = replies.map((r) => r.reply).join('\n\n');
      return { conversationId: conversation.id, replies, reply: combinedReply };
    }

    // No ClawScale reply and no backends — check for auto-select
    const defaultBackend = allBackends.find((b) => b.isDefault);
    const autoSelect = defaultBackend ?? (allBackends.length === 1 ? allBackends[0] : null);

    if (autoSelect) {
      await db.endUserBackend.upsert({
        where: { endUserId_backendId: { endUserId: endUser.id, backendId: autoSelect.id } },
        create: { endUserId: endUser.id, backendId: autoSelect.id },
        update: {},
      });
      activeBackends.push(autoSelect);
    } else if (clawscaleActive) {
      // Show welcome menu
      const menuReply = buildSelectionMenu(clawscaleName, allBackends);
      replies.push({ backendId: null, backendName: clawscaleName, reply: menuReply });
      await db.message.create({
        data: {
          id: generateId('msg'),
          conversationId: conversation.id,
          role: 'assistant',
          content: menuReply,
          backendId: null,
        },
      });
      await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      return { conversationId: conversation.id, replies, reply: menuReply };
    } else {
      return null;
    }
  }

  // 10. Generate replies from all active backends concurrently
  const backendResults = await Promise.allSettled(
    activeBackends.map(async (backend) => {
      const replyText = await runBackend(backend, conversation!.id);
      return { backend, replyText };
    }),
  );

  for (const result of backendResults) {
    if (result.status === 'fulfilled') {
      const { backend, replyText } = result.value;
      const entry: ReplyEntry = {
        backendId: backend.id,
        backendName: backend.name,
        reply: replyText,
      };
      replies.push(entry);

      await db.message.create({
        data: {
          id: generateId('msg'),
          conversationId: conversation.id,
          role: 'assistant',
          content: replyText,
          backendId: backend.id,
          metadata: { backendName: backend.name },
        },
      });
    } else {
      // Backend error — log but don't fail the whole request
      console.error(`[backend:${(result as PromiseRejectedResult).reason}] Error generating reply`);
    }
  }

  await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

  const combinedReply = replies.map((r) =>
    replies.length > 1 && r.backendName ? `**${r.backendName}:**\n${r.reply}` : r.reply,
  ).join('\n\n---\n\n');

  return { conversationId: conversation.id, replies, reply: combinedReply };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Load conversation history for a backend, excluding ClawScale agent messages.
 * Each backend only sees user messages and its own assistant replies.
 */
async function loadHistory(conversationId: string, backendId: string) {
  const msgs = await db.message.findMany({
    where: {
      conversationId,
      OR: [
        { role: 'user' },
        { role: 'assistant', backendId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { role: true, content: true },
  });
  return msgs.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

async function runBackend(
  backend: { id: string; type: string; config: unknown },
  conversationId: string,
): Promise<string> {
  const history = await loadHistory(conversationId, backend.id);

  const cfg = (backend.config ?? {}) as AiBackendProviderConfig;
  return generateReply({
    backend: { type: backend.type as AiBackendType, config: cfg },
    history,
  });
}
