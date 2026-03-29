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
}

export const PLAN_LIMITS: Record<TenantPlan, Pick<TenantSettings, 'maxMembers' | 'maxChannels'>> = {
  starter:    { maxMembers: 5,        maxChannels: 3 },
  business:   { maxMembers: 50,       maxChannels: 20 },
  enterprise: { maxMembers: Infinity, maxChannels: Infinity },
};
