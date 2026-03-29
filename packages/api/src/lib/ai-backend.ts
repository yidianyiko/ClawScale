/**
 * AI Backend — pluggable inference provider.
 *
 * Supported providers:
 *   openai     — OpenAI Chat Completions API
 *   anthropic  — Anthropic Messages API (Claude)
 *   openrouter — OpenRouter (OpenAI-compatible endpoint)
 *   pulse      — Pulse Editor AI manager (streaming SSE, LangChain message format)
 *   openclaw   — OpenClaw instance (OpenAI-compatible at <openClawUrl>/v1)
 *   custom     — Any OpenAI-compatible endpoint
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { AiBackendType, AiBackendProviderConfig } from '@clawscale/shared';

export interface BackendSpec {
  type: AiBackendType;
  config: AiBackendProviderConfig;
}

export interface GenerateOptions {
  backend: BackendSpec | undefined;
  systemPrompt: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

// ── Lazy singletons per config hash ──────────────────────────────────────────

const openaiClients = new Map<string, OpenAI>();
const anthropicClients = new Map<string, Anthropic>();

function getOpenAIClient(apiKey: string, baseURL?: string): OpenAI {
  const key = `${apiKey}::${baseURL ?? ''}`;
  if (!openaiClients.has(key)) {
    openaiClients.set(key, new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }));
  }
  return openaiClients.get(key)!;
}

function getAnthropicClient(apiKey: string): Anthropic {
  if (!anthropicClients.has(apiKey)) {
    anthropicClients.set(apiKey, new Anthropic({ apiKey }));
  }
  return anthropicClients.get(apiKey)!;
}

// ── Provider implementations ──────────────────────────────────────────────────

async function generateOpenAI(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_completion_tokens: 1024,
  });
  return response.choices[0]?.message?.content?.trim() ?? '';
}

async function generateAnthropic(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const response = await client.messages.create({
    model,
    system: systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: 1024,
  });
  const block = response.content[0];
  return block?.type === 'text' ? block.text.trim() : '';
}

async function generatePulse(
  pulseApiUrl: string,
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const messages = [
    { type: 'system', content: systemPrompt },
    ...history.map((m) => ({
      type: m.role === 'user' ? 'human' : 'ai',
      content: m.content,
    })),
  ];

  const res = await fetch(`${pulseApiUrl}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Pulse AI stream error: ${res.status}`);
  }

  const reader = res.body.getReader();
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
        const parsed = JSON.parse(data) as {
          type?: string;
          content?: string;
          delta?: { content?: string };
        };
        const chunk = parsed.delta?.content ?? (parsed.type === 'ai' ? parsed.content : null);
        if (chunk) accumulated += chunk;
      } catch {
        // non-JSON line, skip
      }
    }
  }

  return accumulated.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

const FALLBACK_OPENAI_MODEL = 'gpt-4o-mini';

export async function generateReply({ backend, systemPrompt, history }: GenerateOptions): Promise<string> {
  const type = backend?.type ?? 'openai';
  const cfg = backend?.config ?? {};

  switch (type) {
    case 'openai': {
      const apiKey = cfg.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
      const model = cfg.model || FALLBACK_OPENAI_MODEL;
      return generateOpenAI(getOpenAIClient(apiKey), model, systemPrompt, history);
    }

    case 'anthropic': {
      const apiKey = cfg.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
      const model = cfg.model || 'claude-haiku-4-5-20251001';
      return generateAnthropic(getAnthropicClient(apiKey), model, systemPrompt, history);
    }

    case 'openrouter': {
      const apiKey = cfg.apiKey ?? process.env['OPENROUTER_API_KEY'] ?? '';
      const model = cfg.model || 'openai/gpt-4o-mini';
      const baseURL = cfg.baseUrl || 'https://openrouter.ai/api/v1';
      return generateOpenAI(getOpenAIClient(apiKey, baseURL), model, systemPrompt, history);
    }

    case 'pulse': {
      if (!cfg.pulseApiUrl) throw new Error('Pulse AI backend: pulseApiUrl is required');
      return generatePulse(cfg.pulseApiUrl, systemPrompt, history);
    }

    case 'openclaw': {
      const url = cfg.openClawUrl ?? cfg.baseUrl;
      if (!url) throw new Error('OpenClaw AI backend: openClawUrl is required');
      const apiKey = cfg.apiKey ?? 'openclaw';
      const model = cfg.model || 'default';
      return generateOpenAI(getOpenAIClient(apiKey, `${url.replace(/\/$/, '')}/v1`), model, systemPrompt, history);
    }

    case 'custom': {
      if (!cfg.baseUrl) throw new Error('Custom AI backend: baseUrl is required');
      const apiKey = cfg.apiKey ?? 'custom';
      const model = cfg.model || 'default';
      return generateOpenAI(getOpenAIClient(apiKey, cfg.baseUrl), model, systemPrompt, history);
    }

    default:
      throw new Error(`Unknown AI backend type: ${type}`);
  }
}
