export interface WhatsAppEvolutionConfig {
  instanceName: string;
  webhookToken?: string;
}

export interface StoredWhatsAppEvolutionConfig {
  instanceName: string;
  webhookToken: string;
}

export interface PublicWhatsAppEvolutionConfig {
  instanceName: string;
}

function readNonBlankString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`invalid_whatsapp_evolution_config:${key}`);
  }

  return value.trim();
}

function readOptionalNonBlankString(record: Record<string, unknown>, key: string): string | undefined {
  if (!(key in record) || record[key] == null) {
    return undefined;
  }

  return readNonBlankString(record, key);
}

export function parseWhatsAppEvolutionConfig(value: unknown): WhatsAppEvolutionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_whatsapp_evolution_config');
  }

  const record = value as Record<string, unknown>;
  return {
    instanceName: readNonBlankString(record, 'instanceName'),
    webhookToken: readOptionalNonBlankString(record, 'webhookToken'),
  };
}

export function parseStoredWhatsAppEvolutionConfig(value: unknown): StoredWhatsAppEvolutionConfig {
  const parsed = parseWhatsAppEvolutionConfig(value);
  if (!parsed.webhookToken) {
    throw new Error('invalid_whatsapp_evolution_config:webhookToken');
  }

  return {
    instanceName: parsed.instanceName,
    webhookToken: parsed.webhookToken,
  };
}

export function ensureStoredWhatsAppEvolutionConfig(
  value: unknown,
  createWebhookToken: () => string,
): StoredWhatsAppEvolutionConfig {
  const parsed = parseWhatsAppEvolutionConfig(value);
  return {
    instanceName: parsed.instanceName,
    webhookToken: parsed.webhookToken ?? createWebhookToken(),
  };
}

export function hasWhatsAppEvolutionWebhookToken(value: unknown): boolean {
  return Boolean(parseWhatsAppEvolutionConfig(value).webhookToken);
}

export function buildPublicWhatsAppEvolutionConfig(value: unknown): PublicWhatsAppEvolutionConfig {
  const parsed = parseWhatsAppEvolutionConfig(value);
  return {
    instanceName: parsed.instanceName,
  };
}
