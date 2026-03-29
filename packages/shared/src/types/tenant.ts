export type TenantPlan = 'starter' | 'business' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: TenantPlan;
  settings: TenantSettings;
  createdAt: string;
}

// ── AI Backend ────────────────────────────────────────────────────────────────

export type AiBackendType = 'openai' | 'anthropic' | 'openrouter' | 'pulse' | 'openclaw';

export interface AiBackendConfig {
  /** Which provider to use */
  type: AiBackendType;
  /** Model identifier (provider-specific) */
  model?: string;
  /** API key (OpenAI / Anthropic / OpenRouter) */
  apiKey?: string;
  /** Base URL override — used by OpenRouter and OpenClaw */
  baseUrl?: string;
  /** Pulse Editor AI manager streaming endpoint URL */
  pulseApiUrl?: string;
  /** OpenClaw instance base URL (placeholder) */
  openClawUrl?: string;
}

export const AI_BACKEND_DEFAULTS: Record<AiBackendType, { label: string; defaultModel: string; placeholder?: string }> = {
  openai:      { label: 'OpenAI',          defaultModel: 'gpt-4o-mini' },
  anthropic:   { label: 'Claude (Anthropic)', defaultModel: 'claude-haiku-4-5-20251001' },
  openrouter:  { label: 'OpenRouter',      defaultModel: 'openai/gpt-4o-mini', placeholder: 'https://openrouter.ai/api/v1' },
  pulse:       { label: 'Pulse Editor AI', defaultModel: '' },
  openclaw:    { label: 'OpenClaw',        defaultModel: '' },
};

// ── Tenant Settings ───────────────────────────────────────────────────────────

export interface TenantSettings {
  /** Display name for the AI persona shown to end-users */
  personaName: string;
  /** System prompt that defines the bot's behaviour */
  personaPrompt: string;
  /** Max internal members (staff) allowed on this plan */
  maxMembers: number;
  /** Max social channels allowed on this plan */
  maxChannels: number;
  /**
   * End-user access control policy.
   * - anonymous: anyone who messages the bot can interact with it
   * - whitelist: only externalIds in allowList are permitted
   * - blacklist: externalIds in blockList are denied; everyone else is allowed
   */
  endUserAccess: 'anonymous' | 'whitelist' | 'blacklist';
  allowList?: string[];
  blockList?: string[];
  features: {
    knowledgeBase: boolean;
  };
  /** AI inference backend configuration */
  aiBackend?: AiBackendConfig;
}

export const PLAN_LIMITS: Record<TenantPlan, Pick<TenantSettings, 'maxMembers' | 'maxChannels'>> = {
  starter:    { maxMembers: 5,        maxChannels: 3 },
  business:   { maxMembers: 50,       maxChannels: 20 },
  enterprise: { maxMembers: Infinity, maxChannels: Infinity },
};
