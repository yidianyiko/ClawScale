export type AiBackendType = 'openai' | 'anthropic' | 'openrouter' | 'pulse' | 'openclaw' | 'custom';

export interface AiBackendProviderConfig {
  /** API key (OpenAI / Anthropic / OpenRouter / Custom) */
  apiKey?: string;
  /** Model identifier */
  model?: string;
  /** Base URL override — OpenRouter, Custom, OpenClaw */
  baseUrl?: string;
  /** Pulse Editor AI manager streaming endpoint URL */
  pulseApiUrl?: string;
  /** OpenClaw instance base URL */
  openClawUrl?: string;
}

export interface AiBackend {
  id: string;
  tenantId: string;
  name: string;
  type: AiBackendType;
  config: AiBackendProviderConfig;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const AI_PROVIDER_LABELS: Record<AiBackendType, string> = {
  openai:     'OpenAI',
  anthropic:  'Claude (Anthropic)',
  openrouter: 'OpenRouter',
  pulse:      'Pulse Editor AI',
  openclaw:   'OpenClaw',
  custom:     'Custom (OpenAI-compatible)',
};

export const AI_PROVIDER_TYPES: AiBackendType[] = [
  'openai', 'anthropic', 'openrouter', 'openclaw', 'pulse', 'custom',
];
