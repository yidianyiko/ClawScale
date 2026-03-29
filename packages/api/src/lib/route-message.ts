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
import { parseSlashCommand, type SlashCommand } from './slash-commands.js';
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

  const replies: ReplyEntry[] = [];

  // 8. Check for slash commands (/<agent> <message>)
  const slashCmd = parseSlashCommand(text);
  if (slashCmd) {
    return handleSlashCommand(slashCmd, allBackends, clawscaleName, clawscaleActive, clawscaleStyle, activeBackendIds, endUser.id, conversation, replies);
  }

  // 9. Run ClawScale agent for selection commands / knowledge / menu
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

  // 10. Route to active backends
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

  // 11. Generate replies from all active backends concurrently
  return generateAndPersistReplies(activeBackends, conversation, replies);

  // ── Slash command handler ─────────────────────────────────────────────

  async function handleSlashCommand(
    cmd: SlashCommand,
    backends: typeof allBackends,
    csName: string,
    csActive: boolean,
    csStyle: string | undefined,
    userActiveIds: string[],
    endUserId: string,
    conv: typeof conversation,
    reps: ReplyEntry[],
  ): Promise<RouteResult> {
    // /<target> with no message — show usage
    if (!cmd.message) {
      const backendList = backends.map((b) => {
        const cfg = (b.config ?? {}) as { commandAlias?: string };
        const alias = cfg.commandAlias ? ` (\`/${cfg.commandAlias}\`)` : '';
        return `• ${b.name}${alias}`;
      }).join('\n');
      const helpReply = `Usage: /<agent> <message>\n\nAvailable agents:\n• \`/clawscale\`\n${backendList}`;
      reps.push({ backendId: null, backendName: csName, reply: helpReply });
      await persistAssistantReply(conv.id, helpReply, null);
      await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
      return { conversationId: conv.id, replies: reps, reply: helpReply };
    }

    // Resolve target
    const { resolveTarget } = await import('./slash-commands.js');
    const resolved = resolveTarget(cmd.target, backends);

    if (resolved.type === 'not_found') {
      const backendNames = backends.map((b) => b.name.toLowerCase()).join(', ');
      const errReply = `Unknown agent: "${cmd.target}". Available: clawscale, ${backendNames}`;
      reps.push({ backendId: null, backendName: csName, reply: errReply });
      await persistAssistantReply(conv.id, errReply, null);
      await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
      return { conversationId: conv.id, replies: reps, reply: errReply };
    }

    if (resolved.type === 'clawscale') {
      if (!csActive) {
        const errReply = 'ClawScale assistant is currently disabled.';
        reps.push({ backendId: null, backendName: csName, reply: errReply });
        await persistAssistantReply(conv.id, errReply, null);
        await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
        return { conversationId: conv.id, replies: reps, reply: errReply };
      }

      // Use 'direct' mode — always responds, can manage backends (add/remove/list/clear)
      const agentResponse = clawscaleAgent(
        cmd.message,
        backends.map((b) => ({ id: b.id, name: b.name })),
        userActiveIds,
        csName,
        'direct',
        csStyle,
      );

      // Process add/remove if ClawScale parsed a selection command
      if (agentResponse.addBackendIds?.length) {
        for (const bid of agentResponse.addBackendIds) {
          await db.endUserBackend.upsert({
            where: { endUserId_backendId: { endUserId, backendId: bid } },
            create: { endUserId, backendId: bid },
            update: {},
          });
        }
      }
      if (agentResponse.removeBackendIds?.length) {
        await db.endUserBackend.deleteMany({
          where: { endUserId, backendId: { in: agentResponse.removeBackendIds } },
        });
      }

      if (agentResponse.reply) {
        reps.push({ backendId: null, backendName: csName, reply: agentResponse.reply });
        await persistAssistantReply(conv.id, agentResponse.reply, null);
      }
      await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
      const combinedReply = reps.map((r) => r.reply).join('\n\n');
      return { conversationId: conv.id, replies: reps, reply: combinedReply };
    }

    // Route to a specific backend
    const backend = backends.find((b) => b.id === resolved.backendId);
    if (!backend) {
      const errReply = `Backend "${cmd.target}" is not available.`;
      reps.push({ backendId: null, backendName: csName, reply: errReply });
      await persistAssistantReply(conv.id, errReply, null);
      await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
      return { conversationId: conv.id, replies: reps, reply: errReply };
    }

    return generateAndPersistReplies([backend], conv, reps);
  }

  // ── Shared helpers (closure over conversation) ────────────────────────

  async function persistAssistantReply(convId: string, content: string, backendId: string | null) {
    await db.message.create({
      data: {
        id: generateId('msg'),
        conversationId: convId,
        role: 'assistant',
        content,
        backendId,
      },
    });
  }

  async function generateAndPersistReplies(
    backends: typeof allBackends,
    conv: typeof conversation,
    reps: ReplyEntry[],
  ): Promise<RouteResult> {
    const results = await Promise.allSettled(
      backends.map(async (backend) => {
        const replyText = await runBackend(backend, conv.id);
        return { backend, replyText };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { backend, replyText } = result.value;
        reps.push({ backendId: backend.id, backendName: backend.name, reply: replyText });
        await db.message.create({
          data: {
            id: generateId('msg'),
            conversationId: conv.id,
            role: 'assistant',
            content: replyText,
            backendId: backend.id,
            metadata: { backendName: backend.name },
          },
        });
      } else {
        console.error(`[backend error]`, (result as PromiseRejectedResult).reason);
      }
    }

    await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });

    const combinedReply = reps.map((r) =>
      reps.length > 1 && r.backendName ? `**${r.backendName}:**\n${r.reply}` : r.reply,
    ).join('\n\n---\n\n');

    return { conversationId: conv.id, replies: reps, reply: combinedReply };
  }
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
