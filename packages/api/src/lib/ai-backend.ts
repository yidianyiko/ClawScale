/**
 * AI Backend — pluggable inference provider.
 *
 * ClawScale is a pure forwarder: it sends the user's messages to the backend
 * and returns whatever text (or streamed text) the backend responds with.
 *
 * Supported types:
 *   llm      — OpenAI-compatible Chat Completions API
 *   openclaw — OpenClaw instance (OpenAI-compatible, self-contained)
 *   palmos   — Palmos instance (POST messages, SSE stream back)
 *   upstream    — Generic HTTP endpoint (POST messages, get text back)
 *   claude-code — Claude Code session via MCP channel server bridge
 */

import OpenAI from 'openai';
import type { AiBackendType, AiBackendProviderConfig } from '@clawscale/shared';

export interface PalmosContext {
  endUserId: string;
  tenantId: string;
  conversationId: string;
  displayName?: string;
}

export interface BackendSpec {
  type: AiBackendType;
  config: AiBackendProviderConfig;
  /** Palmos integration context — only used when type is 'palmos' */
  palmosCtx?: PalmosContext;
}

export interface GenerateOptions {
  backend: BackendSpec;
  history: { role: 'user' | 'assistant'; content: string }[];
}

// ── Lazy singletons per config hash ──────────────────────────────────────────

const openaiClients = new Map<string, OpenAI>();

function getOpenAIClient(apiKey: string, baseURL?: string): OpenAI {
  const key = `${apiKey}::${baseURL ?? ''}`;
  if (!openaiClients.has(key)) {
    openaiClients.set(key, new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }));
  }
  return openaiClients.get(key)!;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(cfg: AiBackendProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.authHeader) h['Authorization'] = cfg.authHeader;
  return h;
}

/** Read a simple SSE stream and accumulate text chunks (used by upstream/webhook) */
async function readSseStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data) as { content?: string; delta?: string; text?: string };
        const chunk = parsed.content ?? parsed.delta ?? parsed.text;
        if (chunk) accumulated += chunk;
      } catch {
        // Plain text chunk
        if (data) accumulated += data;
      }
    }
  }

  return accumulated.trim();
}

/** Read a LangGraph SSE stream (event: + data: pairs separated by blank lines) */
async function readLangGraphStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.trim()) continue;

      let eventType = '';
      let dataStr = '';

      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr += line.slice(6);
      }

      if (!eventType || !dataStr) continue;

      let parsed: any;
      try { parsed = JSON.parse(dataStr); } catch { continue; }

      if (eventType === 'messages') {
        // LangGraph format: [chunk, metadata] or [namespace, "messages", [chunk, metadata]]
        if (!Array.isArray(parsed) || parsed.length < 2) continue;
        let chunk: any;
        if (parsed.length >= 3 && typeof parsed[0] === 'string' && Array.isArray(parsed[2])) {
          chunk = parsed[2][0];
        } else {
          chunk = parsed[0];
        }
        if (!chunk) continue;
        const kwargs = chunk.kwargs ?? chunk;
        const content = kwargs.content ?? '';
        if (typeof content === 'string' && content) accumulated += content;
      } else if (eventType === 'values' || eventType === 'result') {
        if (typeof parsed !== 'object' || parsed === null) continue;
        // Check for final text result
        if (typeof parsed.text === 'string' && parsed.text) {
          accumulated = parsed.text; // Final result replaces streamed tokens
        } else if (typeof parsed.agentMessage === 'string' && parsed.agentMessage) {
          accumulated = parsed.agentMessage;
        }
      }
    }
  }

  return accumulated.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

function isConnectionError(err: unknown): string | null {
  const code = (err as { cause?: { code?: string } })?.cause?.code
    ?? (err as { code?: string })?.code;
  return code && CONNECTION_ERROR_CODES.has(code) ? code : null;
}

export async function generateReply(options: GenerateOptions): Promise<string> {
  const { backend, history } = options;
  const { type, config: cfg } = backend;

  try {
  switch (type) {
    // ── LLM: OpenAI-compatible Chat Completions ────────────────────────
    case 'llm': {
      const apiKey = cfg.apiKey ?? '';
      if (!apiKey) throw new Error('LLM backend: apiKey is required');
      const baseURL = cfg.baseUrl;
      const model = cfg.model || 'gpt-4o-mini';
      const systemPrompt = cfg.systemPrompt || '';
      const client = getOpenAIClient(apiKey, baseURL);
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push(...history.map((m) => ({ role: m.role, content: m.content })));
      const response = await client.chat.completions.create({ model, messages, max_completion_tokens: 1024 });
      return response.choices[0]?.message?.content?.trim() ?? '';
    }

    // ── OpenClaw: self-contained, OpenAI-compatible ────────────────────
    case 'openclaw': {
      const url = cfg.baseUrl;
      if (!url) throw new Error('OpenClaw backend: baseUrl is required');
      const apiKey = cfg.apiKey ?? 'openclaw';
      const model = cfg.model || 'default';
      const client = getOpenAIClient(apiKey, `${url.replace(/\/$/, '')}/v1`);
      const response = await client.chat.completions.create({
        model,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        max_completion_tokens: 1024,
      });
      return response.choices[0]?.message?.content?.trim() ?? '';
    }

    // ── Palmos: POST messages, SSE stream response ─────────────────────
    case 'palmos': {
      if (!cfg.apiKey) throw new Error('Palmos backend: apiKey is required');
      const baseUrl = (process.env.PALMOS_BASE_URL ?? cfg.baseUrl ?? 'https://pulse-editor.com').replace(/\/$/, '');
      const palmosHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      };

      // Auto-register external user in Palmos and resolve their Palmos userId
      let palmosUserId: string | undefined;
      const ctx = backend.palmosCtx;
      if (ctx) {
        const regRes = await fetch(`${baseUrl}/api/external-auth/register`, {
          method: 'POST',
          headers: palmosHeaders,
          body: JSON.stringify({
            externalId: ctx.endUserId,
            tenantId: ctx.tenantId,
            userName: ctx.displayName,
          }),
        });
        if (regRes.ok) {
          const regCt = regRes.headers.get('content-type') ?? '';
          if (regCt.includes('application/json')) {
            const regData = (await regRes.json()) as { palmosUserId: string };
            palmosUserId = regData.palmosUserId;
          } else {
            console.warn(`[palmos] Registration returned non-JSON (${regCt}):`, (await regRes.text()).slice(0, 200));
          }
        }
      }

      const res = await fetch(`${baseUrl}/api/agent/manager/stream`, {
        method: 'POST',
        headers: palmosHeaders,
        body: JSON.stringify({
          messages: history,
          ...(palmosUserId ? { userId: palmosUserId } : {}),
          ...(ctx?.conversationId ? { threadId: ctx.conversationId } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Palmos error: ${res.status}`);
      if (res.body) return readLangGraphStream(res.body);
      const text = await res.text();
      return text.trim();
    }

    // ── Webhook: POST messages, get text response (JSON or SSE) ────────
    case 'upstream': {
      if (!cfg.baseUrl) throw new Error('Webhook backend: baseUrl is required');
      const res = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: authHeaders(cfg),
        body: JSON.stringify({ messages: history }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Webhook error: ${res.status}`);

      if (cfg.upstreamStream && res.body) {
        return readSseStream(res.body);
      }

      // Guard against non-JSON responses (e.g. HTML error pages)
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const body = await res.text();
        throw new Error(`Upstream returned non-JSON response (${contentType || 'no content-type'}): ${body.slice(0, 200)}`);
      }

      // JSON response — look for common fields
      const data = (await res.json()) as { reply?: string; content?: string; message?: string; text?: string };
      return (data.reply ?? data.content ?? data.message ?? data.text ?? '').trim();
    }

    // ── Claude Code: MCP channel server bridge ──────────────────────────
    case 'claude-code': {
      if (!cfg.baseUrl) throw new Error('Claude Code backend: baseUrl is required (channel server URL)');
      const url = `${cfg.baseUrl.replace(/\/$/, '')}/message`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.authHeader) headers['Authorization'] = cfg.authHeader;
      else if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: history,
          system_prompt: cfg.systemPrompt,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Claude Code channel error: ${res.status} ${errBody.slice(0, 200)}`);
      }
      const ccContentType = res.headers.get('content-type') ?? '';
      if (!ccContentType.includes('application/json')) {
        const body = await res.text();
        throw new Error(`Claude Code returned non-JSON response (${ccContentType || 'no content-type'}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { ok: boolean; reply?: string; error?: string };
      if (!data.ok) throw new Error(`Claude Code channel error: ${data.error ?? 'unknown'}`);
      return (data.reply ?? '').trim();
    }

    default:
      throw new Error(`Unknown AI backend type: ${type}`);
  }
  } catch (err: unknown) {
    const code = isConnectionError(err);
    if (code) {
      console.warn(`[${type}] Backend unavailable (${code}), skipping`);
      return `⚠️ The ${type} backend is currently unavailable (${code}). Please try again later.`;
    }
    throw err;
  }
}
