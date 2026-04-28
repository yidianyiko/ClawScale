/**
 * ClawScale Default Agent
 *
 * LLM-backed agent using LangChain.js that can answer questions about
 * ClawScale and execute slash commands as tools.
 *
 * Architecture:
 *   - createAgent() from langchain with a `run_command` tool
 *   - The tool calls back into routeInboundMessage to execute slash commands
 *   - The agent loop (reason → act → observe → repeat) is handled by LangChain
 *   - Falls back to a simple rule-based agent when no LLM is configured
 */

import { createAgent, initChatModel, tool } from 'langchain';
import { z } from 'zod/v4';
import { commandList, commandSummary } from './slash-commands.js';

interface BackendOption {
  id: string;
  name: string;
}

/** Config for the LLM that powers the ClawScale agent. */
export interface AgentLlmConfig {
  /** Model string in langchain format, e.g. "openai:gpt-5.4-mini", "anthropic:claude-haiku-4-5-20251001" */
  model: string;
  /** API key for the LLM provider */
  apiKey?: string;
  /** Enable multimodal input (images, files, audio) */
  multimodal?: boolean;
}

interface HistoryAttachment {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
  safeDisplayUrl?: string;
}

interface AgentContext {
  text: string;
  backends: BackendOption[];
  activeIds: string[];
  personaName: string;
  mode: 'select' | 'direct';
  answerStyle?: string;
  llmConfig?: AgentLlmConfig;
  /** Prior conversation history for context continuity. */
  history?: { role: 'user' | 'assistant'; content: string; attachments?: HistoryAttachment[] }[];
  /** Attachments on the current inbound message. */
  attachments?: HistoryAttachment[];
  /** Callback to execute a slash command. Returns the command's output text. */
  executeCommand: (command: string) => Promise<string>;
}

// ── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(ctx: AgentContext): string {
  const backendList = ctx.backends.length > 0
    ? ctx.backends.map((b, i) => {
        const active = ctx.activeIds.includes(b.id) ? ' (active)' : '';
        return `  ${i + 1}. ${b.name}${active}`;
      }).join('\n')
    : '  (none configured)';

  return `You are ${ctx.personaName}, the ClawScale assistant.

ClawScale is a multi-tenant AI chat gateway built by Pulse. It connects messaging platforms (WhatsApp, Telegram, Discord, Slack, LINE, Teams, Signal, Matrix, WeChat, and more) to one or more AI backends — so teams can deploy smart assistants without end-users needing accounts or technical knowledge.

You help users with:
- Answering questions about ClawScale
- Managing their AI backends (adding, removing, listing, switching)
- General conversation

Current state:
- Available backends:
${backendList}
- Active backends: ${ctx.activeIds.length > 0 ? ctx.backends.filter(b => ctx.activeIds.includes(b.id)).map(b => b.name).join(', ') : 'none'}

You have a \`run_command\` tool to execute slash commands. Use it when the user wants to manage backends or needs system information. Available commands:
${commandList()}

When you use a tool, incorporate the result naturally into your response.
Keep responses concise and helpful. Use markdown formatting.${ctx.answerStyle ? `\n\nAnswer style: ${ctx.answerStyle}` : ''}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the ClawScale agent for a single user message.
 *
 * When an LLM is configured, creates a LangChain agent with the run_command
 * tool and lets it handle the full reason/act/observe loop.
 *
 * Falls back to rule-based responses when no LLM is available.
 */
export async function runClawscaleAgent(ctx: AgentContext): Promise<string> {
  // In select mode with active backends, stay silent — let backends handle it
  if (ctx.mode === 'select' && ctx.activeIds.length > 0) {
    return '';
  }

  if (!ctx.llmConfig || !ctx.llmConfig.apiKey) {
    return 'ClawScale assistant is not fully configured yet. Please go to the admin dashboard → Settings to set up your AI model and API key.';
  }

  // Build the run_command tool with the executeCommand callback
  const runCommand = tool(
    async ({ command }) => {
      try {
        return await ctx.executeCommand(command);
      } catch (err) {
        return `Error executing command: ${err}`;
      }
    },
    {
      name: 'run_command',
      description: `Execute a ClawScale slash command. The command MUST start with "/". Available: ${commandSummary()}. To kick an agent: "/team kick <name>". To invite: "/team invite <name>". To list team: "/team".`,
      schema: z.object({
        command: z
          .string()
          .describe('The exact slash command to execute. MUST start with "/". Examples: "/team kick elie", "/team invite gpt", "/backends", "/team"'),
      }),
    },
  );

  const model = await initChatModel(ctx.llmConfig.model, {
    ...(ctx.llmConfig.apiKey && { apiKey: ctx.llmConfig.apiKey }),
  });

  const agent = createAgent({
    model,
    tools: [runCommand],
    systemPrompt: buildSystemPrompt(ctx),
    name: 'clawscale_agent',
  });

  try {
    const multimodal = ctx.llmConfig.multimodal === true;

    function buildContent(text: string, attachments?: HistoryAttachment[]): string | any[] {
      const safeAttachments = attachments ?? [];
      if (!multimodal || safeAttachments.length === 0) return text;
      const parts: any[] = [];
      if (text) parts.push({ type: 'text', text });
      for (const att of safeAttachments) {
        const isImage = att.contentType.startsWith('image/');
        if (isImage && isSafeRemoteImageUrl(att)) {
          parts.push({ type: 'image_url', image_url: { url: att.url } });
        } else if (isImage) {
          parts.push({ type: 'text', text: `[Attached image: ${safeAttachmentDisplay(att)}]` });
        } else {
          parts.push({ type: 'text', text: `[Attached file: ${safeAttachmentDisplay(att)}]` });
        }
      }
      return parts;
    }

    const historyMessages = (ctx.history ?? []).map((m) => ({
      role: m.role,
      content: buildContent(m.content, m.attachments),
    }));
    const result = await agent.invoke({
      messages: [...historyMessages, { role: 'user', content: buildContent(ctx.text, ctx.attachments) }],
    });

    // Extract the last assistant message
    const messages = result.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content.trim();
      }
    }

    return '';
  } catch (err) {
    console.error('[clawscale-agent] LLM error:', err);
    return 'Sorry, something went wrong. Please try again.';
  }
}

function isSafeRemoteImageUrl(att: HistoryAttachment): boolean {
  try {
    const parsed = new URL(att.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    return att.safeDisplayUrl === undefined || att.safeDisplayUrl === att.url;
  } catch {
    return false;
  }
}

function safeAttachmentDisplay(att: HistoryAttachment): string {
  if (att.safeDisplayUrl) return att.safeDisplayUrl;
  if (att.url.startsWith('data:')) {
    return att.contentType.startsWith('image/')
      ? '[redacted inline image attachment]'
      : `[redacted inline ${att.contentType || 'file'} attachment]`;
  }
  if (att.url.startsWith('http://') || att.url.startsWith('https://')) {
    return isSafeRemoteImageUrl(att) ? att.url : `[redacted ${att.contentType || 'file'} attachment]`;
  }
  return att.url;
}

// ── Welcome menu ─────────────────────────────────────────────────────────────

export function buildSelectionMenu(personaName: string, backends: BackendOption[]): string {
  if (backends.length === 0) {
    return (
      `👋 Welcome! I'm ${personaName}.\n\n` +
      `No AI backends have been configured yet — please ask your admin to set one up.\n\n` +
      `In the meantime, you can ask me about ClawScale.`
    );
  }

  const list = backends.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
  return (
    `👋 Welcome! I'm ${personaName}.\n\n` +
    `Available AI backends:\n\n${list}\n\n` +
    `Use \`/add <name|#>\` to add a backend, or type \`/help\` for all commands.`
  );
}
