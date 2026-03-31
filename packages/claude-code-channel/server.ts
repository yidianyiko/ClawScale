#!/usr/bin/env bun
/**
 * ClawScale Channel Server for Claude Code
 *
 * An MCP channel server that bridges ClawScale's messaging platforms
 * (WhatsApp, Discord, Telegram, etc.) into a running Claude Code session.
 *
 * Architecture:
 *   ClawScale API  --POST-->  this server  --MCP notification-->  Claude Code
 *   ClawScale API  <--HTTP--  this server  <--reply tool call--   Claude Code
 *
 * ClawScale's `claude-code` backend type POSTs messages here. This server
 * pushes them into Claude Code via MCP channel notifications. When Claude
 * replies via the reply tool, the HTTP response is sent back to ClawScale,
 * which delivers it to the user on their messaging platform.
 *
 * Usage:
 *   1. Register in .mcp.json (see README or .mcp.json in this directory)
 *   2. Start Claude Code with: claude --channels server:clawscale
 *      (or --dangerously-load-development-channels server:clawscale during preview)
 *   3. Configure a `claude-code` backend in ClawScale pointing to this server's port
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// ── Configuration ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.CLAWSCALE_CHANNEL_PORT ?? '8789', 10);
const HOST = process.env.CLAWSCALE_CHANNEL_HOST ?? '127.0.0.1';
const AUTH_TOKEN = process.env.CLAWSCALE_CHANNEL_TOKEN ?? '';
const REPLY_TIMEOUT_MS = parseInt(process.env.CLAWSCALE_REPLY_TIMEOUT_MS ?? '120000', 10);

// ── Pending request tracking ────────────────────────────────────────────────

interface PendingRequest {
  resolve: (reply: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Map of request_id -> pending HTTP request waiting for Claude's reply */
const pending = new Map<string, PendingRequest>();
let nextId = 1;

function generateRequestId(): string {
  return `cs_${nextId++}_${Date.now().toString(36)}`;
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'clawscale', version: '0.1.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions: [
      'You are connected to ClawScale, a multi-tenant messaging gateway.',
      'Messages arrive as <channel source="clawscale" request_id="..." platform="..." sender="..." conversation_id="...">.',
      'Each message comes from a real user on a messaging platform (WhatsApp, Discord, Telegram, Slack, etc.).',
      'You MUST reply to every message using the clawscale_reply tool, passing back the request_id from the tag.',
      'Keep replies concise and conversational — they will be sent back to the user on their chat platform.',
      'If the message includes a system_prompt attribute, follow those instructions for your persona.',
    ].join(' '),
  },
);

// ── Reply tool ──────────────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'clawscale_reply',
      description:
        'Send a reply back to the user on their messaging platform via ClawScale. ' +
        'Always pass the request_id from the inbound <channel> tag.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          request_id: {
            type: 'string',
            description: 'The request_id from the inbound <channel> tag',
          },
          text: {
            type: 'string',
            description: 'The reply message to send to the user',
          },
        },
        required: ['request_id', 'text'],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'clawscale_reply') {
    const { request_id, text } = req.params.arguments as {
      request_id: string;
      text: string;
    };

    const entry = pending.get(request_id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(request_id);
      entry.resolve(text);
      return { content: [{ type: 'text' as const, text: 'sent' }] };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `No pending request with id "${request_id}" (it may have timed out)`,
        },
      ],
    };
  }

  throw new Error(`unknown tool: ${req.params.name}`);
});

// ── Permission relay ────────────────────────────────────────────────────────

const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  // Log permission requests to stderr (visible in Claude Code debug log)
  console.error(
    `[clawscale-channel] Permission request: ${params.tool_name} — ${params.description} (id: ${params.request_id})`,
  );
});

// ── Connect to Claude Code ──────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport());

// ── HTTP Server ─────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 0,

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, channel: 'clawscale', version: '0.1.0' });
    }

    // POST /message — inbound from ClawScale API
    if (req.method === 'POST' && url.pathname === '/message') {
      // Auth check
      if (AUTH_TOKEN) {
        const auth = req.headers.get('Authorization');
        if (auth !== `Bearer ${AUTH_TOKEN}`) {
          return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        }
      }

      let body: {
        messages: { role: string; content: string }[];
        platform?: string;
        sender?: string;
        conversation_id?: string;
        system_prompt?: string;
      };

      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
      }

      if (!body.messages?.length) {
        return Response.json({ ok: false, error: 'messages array required' }, { status: 400 });
      }

      // Extract the last user message
      const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user');
      if (!lastUserMsg) {
        return Response.json({ ok: false, error: 'no user message found' }, { status: 400 });
      }

      // Build context from history
      const history = body.messages.slice(0, -1);
      let content = lastUserMsg.content;
      if (history.length > 0) {
        const ctx = history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n');
        content = `Previous conversation:\n${ctx}\n\nUser: ${content}`;
      }

      const requestId = generateRequestId();

      // Build meta attributes for the <channel> tag
      const meta: Record<string, string> = { request_id: requestId };
      if (body.platform) meta.platform = body.platform;
      if (body.sender) meta.sender = body.sender;
      if (body.conversation_id) meta.conversation_id = body.conversation_id;
      if (body.system_prompt) meta.system_prompt = body.system_prompt;

      // Create a promise that resolves when Claude replies
      const replyPromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('Reply timeout'));
        }, REPLY_TIMEOUT_MS);

        pending.set(requestId, { resolve, reject, timer });
      });

      // Push message into Claude Code session
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: { content, meta },
      });

      // Wait for Claude's reply
      try {
        const reply = await replyPromise;
        return Response.json({ ok: true, reply });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return Response.json({ ok: false, error: message }, { status: 504 });
      }
    }

    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
});

console.error(`[clawscale-channel] Listening on ${HOST}:${PORT}`);
