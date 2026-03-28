export type TenantPlan = 'starter' | 'business' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: TenantPlan;
  settings: TenantSettings;
  createdAt: string;
}

export interface TenantSettings {
  /** Display name for the shared AI persona */
  personaName: string;
  /** System prompt for the shared AI persona */
  personaPrompt: string;
  /** Max users allowed on this plan */
  maxUsers: number;
  /** Max channels allowed on this plan */
  maxChannels: number;
  /** Feature flags */
  features: {
    sharedMemory: boolean;
    privateThreads: boolean;
    knowledgeBase: boolean;
  };
}

export const PLAN_LIMITS: Record<TenantPlan, Pick<TenantSettings, 'maxUsers' | 'maxChannels'>> = {
  starter: { maxUsers: 5, maxChannels: 3 },
  business: { maxUsers: 50, maxChannels: 20 },
  enterprise: { maxUsers: Infinity, maxChannels: Infinity },
};
