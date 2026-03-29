/**
 * routeInboundMessage — central message routing function.
 *
 * All channel adapters call this directly. It handles:
 *   - EndUser creation / lookup
 *   - Access policy enforcement
 *   - Conversation management
 *   - Message persistence
 *   - AI backend selection (multi-backend menu or auto-select)
 *   - Reply generation and persistence
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

export interface RouteResult {
  conversationId: string;
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
    personaPrompt?: string;
    endUserAccess?: 'anonymous' | 'whitelist' | 'blacklist';
    allowList?: string[];
    blockList?: string[];
  };
  const personaName = settings.personaName ?? 'Assistant';
  const personaPrompt = settings.personaPrompt ?? 'You are a helpful assistant.';

  // 3. Find or create EndUser
  let endUser = await db.endUser.findUnique({
    where: { tenantId_channelId_externalId: { tenantId, channelId, externalId } },
  });

  if (!endUser) {
    endUser = await db.endUser.create({
      data: {
        id: generateId('eu'),
        tenantId, channelId, externalId,
        name: displayName ?? null,
        status: 'allowed',
      },
    });
  } else if (displayName && !endUser.name) {
    endUser = await db.endUser.update({
      where: { id: endUser.id },
      data: { name: displayName },
    });
  }

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

  // 7. Load active AI backends for this tenant
  const backends = await db.aiBackend.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  // 8. Resolve which backend to use and generate reply
  let selectedBackendId = endUser.selectedBackendId;
  let replyText: string;

  if (backends.length === 1 && !selectedBackendId) {
    // Auto-select the only backend silently
    selectedBackendId = backends[0].id;
    await db.endUser.update({ where: { id: endUser.id }, data: { selectedBackendId } });
    await db.conversation.update({ where: { id: conversation.id }, data: { backendId: selectedBackendId } });
    replyText = await runBackend(backends[0], personaPrompt, conversation.id);

  } else if (!selectedBackendId) {
    // No backend selected yet — run the built-in ClawScale default agent.
    // It handles: greeting menu, ClawScale knowledge, backend selection by number.
    const agentResponse = clawscaleAgent(text, backends, personaName);

    if (agentResponse.selectedBackendId) {
      selectedBackendId = agentResponse.selectedBackendId;
      await db.endUser.update({ where: { id: endUser.id }, data: { selectedBackendId } });
      await db.conversation.update({ where: { id: conversation.id }, data: { backendId: selectedBackendId } });
    }

    replyText = agentResponse.reply;

  } else {
    // User already has a selected backend
    const backend = backends.find((b) => b.id === selectedBackendId);
    if (!backend) {
      // Their previously selected backend was deleted — reset and re-prompt
      await db.endUser.update({ where: { id: endUser.id }, data: { selectedBackendId: null } });
      replyText = `⚠️ Your previous AI assistant is no longer available.\n\n${buildSelectionMenu(personaName, backends)}`;
    } else {
      replyText = await runBackend(backend, personaPrompt, conversation.id);
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

  return { conversationId: conversation.id, reply: replyText };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  backend: { type: string; config: unknown } | undefined,
  personaPrompt: string,
  conversationId: string,
): Promise<string> {
  const history = await loadHistory(conversationId);

  const { tenantId } = (await db.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true },
  }))!;

  const workflows = await db.workflow.findMany({
    where: { tenantId, isActive: true },
    select: { name: true, description: true },
  });

  const systemPrompt = workflows.length > 0
    ? `${personaPrompt}\n\nYou have access to the following workflows:\n${workflows.map((w) => `- ${w.name}${w.description ? ': ' + w.description : ''}`).join('\n')}`
    : personaPrompt;

  if (!backend) {
    return generateReply({ backend: undefined, systemPrompt, history });
  }

  const cfg = (backend.config ?? {}) as AiBackendProviderConfig;
  return generateReply({
    backend: { type: backend.type as AiBackendType, config: cfg },
    systemPrompt,
    history,
  });
}
