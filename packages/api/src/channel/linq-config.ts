export interface StoredLinqConfig {
  fromNumber: string;
  webhookToken?: string;
  webhookSubscriptionId?: string;
  signingSecret?: string;
}

export interface PublicLinqConfig {
  fromNumber: string;
  webhookSubscriptionId?: string;
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('linq_config_invalid');
  }

  return value as Record<string, unknown>;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`linq_config_invalid:${key}`);
  }

  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  if (!(key in record) || record[key] == null) {
    return undefined;
  }

  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`linq_config_invalid:${key}`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeLinqPhoneNumber(value: string): string {
  const digits = value.replace(/\D+/g, '');
  if (!digits) {
    throw new Error('invalid_linq_phone_number');
  }

  return `+${digits}`;
}

export function parseStoredLinqConfig(value: unknown): StoredLinqConfig {
  const record = assertRecord(value);
  return {
    fromNumber: normalizeLinqPhoneNumber(readRequiredString(record, 'fromNumber')),
    webhookToken: readOptionalString(record, 'webhookToken'),
    webhookSubscriptionId: readOptionalString(record, 'webhookSubscriptionId'),
    signingSecret: readOptionalString(record, 'signingSecret'),
  };
}

export function buildPublicLinqConfig(value: unknown): PublicLinqConfig {
  const parsed = parseStoredLinqConfig(value);
  return {
    fromNumber: parsed.fromNumber,
    webhookSubscriptionId: parsed.webhookSubscriptionId,
  };
}

export function ensureStoredLinqConfig(value: unknown, tokenFactory: () => string): StoredLinqConfig {
  const parsed = parseStoredLinqConfig(value);
  return {
    ...parsed,
    webhookToken: parsed.webhookToken ?? tokenFactory(),
  };
}

export function hasLinqWebhookToken(value: unknown): boolean {
  try {
    return Boolean(parseStoredLinqConfig(value).webhookToken);
  } catch {
    return false;
  }
}

export function hasLinqSigningSecret(value: unknown): boolean {
  try {
    return Boolean(parseStoredLinqConfig(value).signingSecret);
  } catch {
    return false;
  }
}
