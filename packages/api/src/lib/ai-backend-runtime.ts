export type AiBackendType = 'custom';

export interface AiBackendProviderConfig {
  baseUrl?: string;
  authHeader?: string;
  apiKey?: string;
  systemPrompt?: string;
}
