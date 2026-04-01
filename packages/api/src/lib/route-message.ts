/**
 * routeInboundMessage — central message routing function.
 *
 * All channel adapters call this directly. It handles:
 *   - EndUser creation / lookup
 *   - Access policy enforcement
 *   - Conversation management
 *   - Message persistence
 *   - Commands: /backends, /add, /remove, /clear, /help
 *   - Direct messages: agent> message
 *   - AI backend routing (multi-backend)
 */

import { db } from '../db/index.js';
import { generateId } from './id.js';
import { generateReply } from './ai-backend.js';
import { runClawscaleAgent, buildSelectionMenu } from './clawscale-agent.js';
import type { AgentLlmConfig } from './clawscale-agent.js';
import { parseCommand, resolveTarget, resolveAddRemoveArg, formatCommandHelp } from './slash-commands.js';
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

  // 2. Load tenant settings
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const settings = (tenant?.settings ?? {}) as {
    personaName?: string;
    endUserAccess?: 'anonymous' | 'whitelist' | 'blacklist';
    allowList?: string[];
    clawscale?: { name?: string; answerStyle?: string; isActive?: boolean; llm?: AgentLlmConfig };
    blockList?: string[];
  };

  // 3. Find or create EndUser
  let endUser = await db.endUser.findUnique({
    where: { tenantId_channelId_externalId: { tenantId, channelId, externalId } },
    include: { activeBackends: { select: { backendId: true } } },
  });
  const isNewUser = !endUser;
  if (!endUser) {
    endUser = await db.endUser.create({
      data: { id: generateId('eu'), tenantId, channelId, externalId, name: displayName ?? null, status: 'allowed' },
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
    data: { id: generateId('msg'), conversationId: conversation.id, role: 'user', content: text, metadata: (meta ?? {}) as any },
  });

  // 7. Load backends and ClawScale config
  const clawscaleCfg = settings.clawscale ?? {};
  const clawscaleName = clawscaleCfg.name ?? 'ClawScale Assistant';
  const clawscaleStyle = clawscaleCfg.answerStyle;
  const clawscaleActive = clawscaleCfg.isActive !== false;
  const clawscaleLlm = clawscaleCfg.llm ?? { model: 'openai:gpt-5.4-mini' };

  const allBackends = await db.aiBackend.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  const replies: ReplyEntry[] = [];

  /**
   * Run the ClawScale LangChain agent.
   *
   * The agent handles the full reason → act → observe loop internally.
   * Slash commands are executed via a callback that re-enters routeInboundMessage.
   */
  async function runAgent(userText: string, mode: 'select' | 'direct'): Promise<RouteResult> {
    const agentReply = await runClawscaleAgent({
      text: userText,
      backends: allBackends.map((b) => ({ id: b.id, name: b.name })),
      activeIds: [...activeBackendIds],
      personaName: clawscaleName,
      mode,
      ...(clawscaleStyle != null && { answerStyle: clawscaleStyle }),
      ...(clawscaleLlm != null && { llmConfig: clawscaleLlm }),
      executeCommand: async (command) => {
        // Ensure command starts with "/" — reject plain-text commands
        // that would be routed as regular messages instead of executed.
        const trimmed = command.trim();
        if (!trimmed.startsWith('/')) {
          return `Error: "${trimmed}" is not a valid command. Commands must start with "/". Example: /team kick elie`;
        }
        const result = await routeInboundMessage({ ...input, text: trimmed });
        return result?.reply ?? '(no result)';
      },
    });

    if (!agentReply) return { conversationId: conversation!.id, replies, reply: '' };
    return reply(agentReply);
  }

  // ── Helper closures ─────────────────────────────────────────────────

  async function reply(content: string, backendId: string | null = null, backendName: string | null = clawscaleName): Promise<RouteResult> {
    replies.push({ backendId, backendName, reply: content });
    await db.message.create({
      data: { id: generateId('msg'), conversationId: conversation!.id, role: 'assistant', content, backendId },
    });
    await db.conversation.update({ where: { id: conversation!.id }, data: { updatedAt: new Date() } });
    const combined = replies.map((r) =>
      r.backendName ? `[${r.backendName}]\n${r.reply}` : r.reply,
    ).join('\n\n---\n\n');
    return { conversationId: conversation!.id, replies, reply: combined };
  }

  async function addBackend(backendId: string) {
    await db.endUserBackend.upsert({
      where: { endUserId_backendId: { endUserId: endUser!.id, backendId } },
      create: { endUserId: endUser!.id, backendId },
      update: {},
    });
    if (!activeBackendIds.includes(backendId)) activeBackendIds.push(backendId);
  }

  async function removeBackend(backendId: string) {
    await db.endUserBackend.deleteMany({
      where: { endUserId: endUser!.id, backendId },
    });
    const idx = activeBackendIds.indexOf(backendId);
    if (idx !== -1) activeBackendIds.splice(idx, 1);
  }

  async function removeAllBackends() {
    await db.endUserBackend.deleteMany({ where: { endUserId: endUser!.id } });
    activeBackendIds.length = 0;
  }

  function formatList(highlightActive = true): string {
    return allBackends.map((b, i) => {
      const active = highlightActive && activeBackendIds.includes(b.id) ? ' ✅' : '';
      return `${i + 1}. ${b.name}${active}`;
    }).join('\n');
  }

  async function routeToBackends(backends: typeof allBackends): Promise<RouteResult> {
    const primaryEndUserId = endUser!.linkedTo ?? endUser!.id;
    const palmosCtx = {
      endUserId: primaryEndUserId,
      tenantId,
      conversationId: conversation!.id,
      displayName: endUser!.name ?? displayName,
    };
    const results = await Promise.allSettled(
      backends.map(async (backend) => {
        const replyText = await runBackend(backend, conversation!.id, palmosCtx);
        return { backend, replyText };
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { backend, replyText } = result.value;
        replies.push({ backendId: backend.id, backendName: backend.name, reply: replyText });
        await db.message.create({
          data: {
            id: generateId('msg'), conversationId: conversation!.id,
            role: 'assistant', content: replyText, backendId: backend.id,
            metadata: { backendName: backend.name },
          },
        });
      } else {
        console.error('[backend error]', (result as PromiseRejectedResult).reason);
      }
    }
    await db.conversation.update({ where: { id: conversation!.id }, data: { updatedAt: new Date() } });
    const combined = replies.map((r) =>
      r.backendName ? `[${r.backendName}]\n${r.reply}` : r.reply,
    ).join('\n\n---\n\n');
    return { conversationId: conversation!.id, replies, reply: combined };
  }

  // 8. Parse commands
  const cmd = parseCommand(text);

  if (cmd) {
    // ── System commands ────────────────────────────────────────────────
    if (cmd.kind === 'system') {
      switch (cmd.command) {
        case 'help': {
          return reply(formatCommandHelp());
        }

        case 'team': {
          // Parse subcommand: /team, /team invite <arg>, /team kick [arg]
          const subMatch = cmd.arg.match(/^(invite|kick)(?:\s+([\s\S]+))?$/i);

          if (!subMatch) {
            // /team with no subcommand — show team
            const agents: string[] = [];
            if (clawscaleActive) {
              agents.push(`• *${clawscaleName}* — ClawScale assistant`);
            }
            for (const b of allBackends) {
              if (activeBackendIds.includes(b.id)) {
                agents.push(`• *${b.name}*`);
              }
            }
            if (agents.length === 0) {
              return reply('No agents in your team yet. Use `/team invite <name|#>` to add one.');
            }
            return reply(`*Your team:*\n\n${agents.join('\n')}`);
          }

          const sub = subMatch[1]!.toLowerCase();
          const subArg = (subMatch[2] ?? '').trim();

          if (sub === 'invite') {
            if (!subArg) {
              return reply(`Usage: \`/team invite <name|#>\`\n\n${formatList()}`);
            }
            const resolved = resolveAddRemoveArg(subArg, allBackends);
            if (resolved.type !== 'backend' || !resolved.backendId) {
              return reply(`Agent not found: "${subArg}"\n\nAvailable:\n\n${formatList()}`);
            }
            if (activeBackendIds.includes(resolved.backendId)) {
              return reply(`*${resolved.backendName}* is already in your team.`);
            }
            await addBackend(resolved.backendId);
            return reply(`✅ *${resolved.backendName}* joined the team.\n\nActive agents:\n\n${formatList()}`);
          }

          if (sub === 'kick') {
            if (!subArg) {
              // /team kick — kick all
              if (activeBackendIds.length === 0) {
                return reply('No active agents to kick.');
              }
              await removeAllBackends();
              return reply(`✅ Kicked all agents.\n\nAvailable:\n\n${formatList()}`);
            }
            const resolved = resolveAddRemoveArg(subArg, allBackends);
            if (resolved.type !== 'backend' || !resolved.backendId) {
              return reply(`Agent not found: "${subArg}"\n\nActive agents:\n\n${formatList()}`);
            }
            if (!activeBackendIds.includes(resolved.backendId)) {
              return reply(`*${resolved.backendName}* is not currently in your team.`);
            }
            await removeBackend(resolved.backendId);
            return reply(`✅ Kicked *${resolved.backendName}*.\n\nActive agents:\n\n${formatList()}`);
          }

          return reply(`Unknown subcommand. Usage:\n\`/team invite <name|#>\`\n\`/team kick <name|#>\``);
        }

        case 'backends': {
          if (allBackends.length === 0) {
            return reply('No AI backends have been configured. Ask your admin to set one up.');
          }
          const active = allBackends.filter((b) => activeBackendIds.includes(b.id));
          const activeStr = active.length > 0
            ? `\n\n*Active:* ${active.map((b) => b.name).join(', ')}`
            : '\n\nNo backends active. Use `/team invite <name|#>` to add one.';
          return reply(`*Available backends:*\n\n${formatList()}${activeStr}`);
        }

        case 'clear': {
          // Delete all messages in the conversation
          await db.message.deleteMany({ where: { conversationId: conversation.id } });
          return reply('✅ Conversation context cleared.');
        }

        case 'link': {
          if (!cmd.arg) {
            // Generate a link code
            const code = String(Math.floor(100000 + Math.random() * 900000));
            await db.linkCode.create({
              data: {
                code,
                tenantId,
                endUserId: endUser!.id,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
              },
            });
            return reply(`Your link code: **${code}**\n\nEnter this code from your other channel within 10 minutes:\n\`/link ${code}\``);
          }

          // Consume a link code
          const linkCode = await db.linkCode.findFirst({
            where: {
              code: cmd.arg,
              used: false,
              tenantId,
              expiresAt: { gt: new Date() },
            },
            include: { endUser: true },
          });

          if (!linkCode) {
            return reply('Invalid or expired link code.');
          }
          if (linkCode.endUserId === endUser!.id) {
            return reply("You can't link to yourself.");
          }

          // Resolve primary: if source is already linked, follow to its primary
          const primaryId = linkCode.endUser.linkedTo ?? linkCode.endUserId;

          // Set current EndUser's linkedTo
          await db.endUser.update({
            where: { id: endUser!.id },
            data: { linkedTo: primaryId },
          });

          // Mark code as used
          await db.linkCode.update({
            where: { id: linkCode.id },
            data: { used: true },
          });

          // Copy active backends from primary
          const primaryBackends = await db.endUserBackend.findMany({
            where: { endUserId: primaryId },
          });
          for (const pb of primaryBackends) {
            await db.endUserBackend.upsert({
              where: { endUserId_backendId: { endUserId: endUser!.id, backendId: pb.backendId } },
              create: { endUserId: endUser!.id, backendId: pb.backendId },
              update: {},
            });
          }

          const sourceName = linkCode.endUser.name ?? linkCode.endUser.externalId;
          return reply(`✅ Linked to *${sourceName}*'s account. Your identities are now connected across channels.`);
        }

        case 'unlink': {
          if (!endUser!.linkedTo) {
            return reply('This channel is not linked to another account.');
          }
          await db.endUser.update({
            where: { id: endUser!.id },
            data: { linkedTo: null },
          });
          return reply('✅ Unlinked. This channel now has its own separate identity.');
        }
      }
    }

    // ── Direct message: agent> message ─────────────────────────────────
    if (cmd.kind === 'direct') {
      if (!cmd.message) {
        return reply(`Usage: \`${cmd.target}> message\``);
      }

      const resolved = resolveTarget(cmd.target, allBackends);

      if (resolved.type === 'not_found') {
        const names = allBackends.map((b) => b.name.toLowerCase()).join(', ');
        return reply(`Unknown agent: "${cmd.target}". Available: clawscale, ${names}`);
      }

      if (resolved.type === 'clawscale') {
        if (!clawscaleActive) {
          return reply('ClawScale assistant is currently disabled.');
        }
        // Direct mode — run agent loop (may execute commands)
        return runAgent(cmd.message, 'direct');
      }

      // Route to specific backend
      const backend = allBackends.find((b) => b.id === resolved.backendId);
      if (!backend) {
        return reply(`Backend "${cmd.target}" is not available.`);
      }
      return routeToBackends([backend]);
    }
  }

  // 9. No command — route to active backends or show menu
  const activeBackends = allBackends.filter((b) => activeBackendIds.includes(b.id));

  if (activeBackends.length > 0) {
    return routeToBackends(activeBackends);
  }

  // No active backends — auto-select only for brand-new users
  if (isNewUser) {
    const defaultBackend = allBackends.find((b) => b.isDefault);
    const autoSelect = defaultBackend ?? (allBackends.length === 1 ? allBackends[0] : null);

    if (autoSelect) {
      await addBackend(autoSelect.id);
      return routeToBackends([autoSelect]);
    }
  }

  // Run ClawScale agent loop (handles knowledge base + command execution)
  if (clawscaleActive) {
    const result = await runAgent(text, 'select');
    // If agent returned empty (silent), fall back to welcome menu
    if (!result.reply) {
      const menuReply = buildSelectionMenu(clawscaleName, allBackends);
      return reply(menuReply);
    }
    return result;
  }

  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  palmosCtx?: { endUserId: string; tenantId: string; conversationId: string; displayName?: string },
): Promise<string> {
  const history = await loadHistory(conversationId, backend.id);
  const cfg = (backend.config ?? {}) as AiBackendProviderConfig;
  return generateReply({
    backend: {
      type: backend.type as AiBackendType,
      config: cfg,
      ...(backend.type === 'palmos' && palmosCtx ? { palmosCtx } : {}),
    },
    history,
  });
}
