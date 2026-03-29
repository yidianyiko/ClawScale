export type TenantPlan = 'starter' | 'business' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: TenantPlan;
  settings: TenantSettings;
  createdAt: string;
}

// ── Tenant Settings ───────────────────────────────────────────────────────────

export interface ClawScaleAgentSettings {
  /** Display name shown to end-users (default: "ClawScale Assistant") */
  name?: string;
  /**
   * Optional style/postscript appended to knowledge-base and off-topic replies.
   * The backend-selection menu is always shown as-is.
   * Example: "Always be concise. Contact support@acme.com for help."
   */
  answerStyle?: string;
  /** Whether the orchestrator responds at all (default: true) */
  isActive?: boolean;
  /** LLM configuration for the ClawScale agent */
  llm?: {
    /** LangChain model string, e.g. "openai:gpt-5.4-mini", "anthropic:claude-haiku-4-5-20251001" */
    model: string;
  };
}

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
  /** Built-in ClawScale orchestrator agent configuration */
  clawscale?: ClawScaleAgentSettings;
}

export const PLAN_LIMITS: Record<TenantPlan, Pick<TenantSettings, 'maxMembers' | 'maxChannels'>> = {
  starter:    { maxMembers: 5,        maxChannels: 3 },
  business:   { maxMembers: 50,       maxChannels: 20 },
  enterprise: { maxMembers: Infinity, maxChannels: Infinity },
};
