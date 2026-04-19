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

export function parseStoredWhatsAppEvolutionConfig(value: unknown): StoredWhatsAppEvolutionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_whatsapp_evolution_config');
  }

  const record = value as Record<string, unknown>;
  return {
    instanceName: readNonBlankString(record, 'instanceName'),
    webhookToken: readNonBlankString(record, 'webhookToken'),
  };
}

export function buildPublicWhatsAppEvolutionConfig(value: unknown): PublicWhatsAppEvolutionConfig {
  const parsed = parseStoredWhatsAppEvolutionConfig(value);
  return {
    instanceName: parsed.instanceName,
  };
}
