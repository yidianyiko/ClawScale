export type AiBackendType = 'llm' | 'openclaw' | 'palmos' | 'upstream';

export interface AiBackendProviderConfig {
  /** API key */
  apiKey?: string;
  /** Model identifier (LLM / OpenClaw) */
  model?: string;
  /** System prompt (LLM only) */
  systemPrompt?: string;
  /** Base URL — LLM endpoint, OpenClaw instance, Palmos instance, or upstream URL */
  baseUrl?: string;
  /** Short alias for /say command (e.g. "gpt" so users can type /say gpt hello) */
  commandAlias?: string;
  /** Optional Authorization header value sent to the backend */
  authHeader?: string;
  /** Webhook response mode: 'json' (default) or 'sse' (streamed) */
  upstreamStream?: boolean;
}

export interface AiBackend {
  id: string;
  tenantId: string;
  name: string;
  type: AiBackendType;
  config: AiBackendProviderConfig;
  isActive: boolean;
  /** True for the built-in ClawScale default agent (one per tenant). */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const AI_PROVIDER_LABELS: Record<AiBackendType, string> = {
  llm:      'LLM',
  openclaw: 'OpenClaw',
  palmos:   'Palmos',
  upstream:  'Custom API',
};

export const AI_PROVIDER_TYPES: AiBackendType[] = [
  'llm', 'openclaw', 'palmos', 'upstream',
];
