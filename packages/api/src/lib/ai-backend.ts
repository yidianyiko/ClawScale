/**
 * AI Backend — pluggable inference provider.
 *
 * Each backend is a self-contained black box. ClawScale never injects its own
 * prompt — the system prompt lives in the backend's config (for basic LLM
 * types) or inside the external service itself (OpenClaw, Pulse, Custom).
 *
 * Supported providers:
 *   openai     — OpenAI Chat Completions API (basic LLM)
 *   anthropic  — Anthropic Messages API (basic LLM)
 *   openrouter — OpenRouter (basic LLM, OpenAI-compatible)
 *   pulse      — Pulse Editor AI manager (external, self-contained)
 *   openclaw   — OpenClaw instance (external, self-contained)
 *   custom     — Any OpenAI-compatible endpoint (external, self-contained)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { AiBackendType, AiBackendProviderConfig } from '@clawscale/shared';

export interface BackendSpec {
  type: AiBackendType;
  config: AiBackendProviderConfig;
}

export interface GenerateOptions {
  backend: BackendSpec;
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

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

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
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  // Pulse AI manager is self-contained — just forward the conversation history.
  // No system prompt injected; the Pulse agent has its own personality.
  const messages = history.map((m) => ({
    type: m.role === 'user' ? 'human' : 'ai',
    content: m.content,
  }));

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

export async function generateReply({ backend, history }: GenerateOptions): Promise<string> {
  const { type, config: cfg } = backend;

  switch (type) {
    // ── Basic LLM backends: use config.systemPrompt ─────────────────────
    case 'openai': {
      const apiKey = cfg.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
      const model = cfg.model || FALLBACK_OPENAI_MODEL;
      const prompt = cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      return generateOpenAI(getOpenAIClient(apiKey), model, prompt, history);
    }

    case 'anthropic': {
      const apiKey = cfg.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
      const model = cfg.model || 'claude-haiku-4-5-20251001';
      const prompt = cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      return generateAnthropic(getAnthropicClient(apiKey), model, prompt, history);
    }

    case 'openrouter': {
      const apiKey = cfg.apiKey ?? process.env['OPENROUTER_API_KEY'] ?? '';
      const model = cfg.model || 'openai/gpt-4o-mini';
      const baseURL = cfg.baseUrl || 'https://openrouter.ai/api/v1';
      const prompt = cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      return generateOpenAI(getOpenAIClient(apiKey, baseURL), model, prompt, history);
    }

    // ── External backends: self-contained, no prompt injection ──────────
    case 'pulse': {
      if (!cfg.pulseApiUrl) throw new Error('Pulse AI backend: pulseApiUrl is required');
      return generatePulse(cfg.pulseApiUrl, history);
    }

    case 'openclaw': {
      // OpenClaw is self-contained — it has its own prompt/tools configured internally.
      // We just forward messages via the OpenAI-compatible API.
      const url = cfg.openClawUrl ?? cfg.baseUrl;
      if (!url) throw new Error('OpenClaw AI backend: openClawUrl is required');
      const apiKey = cfg.apiKey ?? 'openclaw';
      const model = cfg.model || 'default';
      // No system prompt — OpenClaw manages its own personality
      return generateOpenAI(getOpenAIClient(apiKey, `${url.replace(/\/$/, '')}/v1`), model, '', history);
    }

    case 'custom': {
      // Custom endpoints are assumed self-contained — they manage their own prompt.
      // If admin provides a systemPrompt in config, we'll use it (for simple setups).
      if (!cfg.baseUrl) throw new Error('Custom AI backend: baseUrl is required');
      const apiKey = cfg.apiKey ?? 'custom';
      const model = cfg.model || 'default';
      const prompt = cfg.systemPrompt || '';
      return generateOpenAI(getOpenAIClient(apiKey, cfg.baseUrl), model, prompt, history);
    }

    default:
      throw new Error(`Unknown AI backend type: ${type}`);
  }
}
