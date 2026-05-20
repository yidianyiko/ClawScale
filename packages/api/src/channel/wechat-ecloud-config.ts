export const DEFAULT_WECHAT_ECLOUD_BASE_URL = 'https://api.geweapi.com';
export const WECHAT_ECLOUD_CALLBACK_PATH = '/gateway/ecloud/wechat/:channelId/:token';

export interface WechatEcloudConfigInput {
  appId: string;
  token: string;
  baseUrl?: string;
  webhookToken?: string;
}

export interface StoredWechatEcloudConfig {
  appId: string;
  token: string;
  baseUrl: string;
  webhookToken: string;
}

export interface PublicWechatEcloudConfig {
  appId: string;
  baseUrl: string;
  callbackPath: typeof WECHAT_ECLOUD_CALLBACK_PATH;
}

interface ParsedWechatEcloudConfigInput {
  appId: string;
  token: string;
  baseUrl: string;
  webhookToken?: string;
}

function readNonBlankString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`invalid_wechat_ecloud_config:${key}`);
  }

  return value.trim();
}

function readOptionalNonBlankString(record: Record<string, unknown>, key: string): string | undefined {
  if (!(key in record) || record[key] == null) {
    return undefined;
  }

  return readNonBlankString(record, key);
}

function readConfigRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_wechat_ecloud_config');
  }

  return value as Record<string, unknown>;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('invalid_wechat_ecloud_config:baseUrl');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('invalid_wechat_ecloud_config:baseUrl');
  }

  return parsed.href.replace(/\/+$/, '');
}

export function parseWechatEcloudConfigInput(value: unknown): ParsedWechatEcloudConfigInput {
  const record = readConfigRecord(value);
  const baseUrl = readOptionalNonBlankString(record, 'baseUrl');
  return {
    appId: readNonBlankString(record, 'appId'),
    token: readNonBlankString(record, 'token'),
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : DEFAULT_WECHAT_ECLOUD_BASE_URL,
    webhookToken: readOptionalNonBlankString(record, 'webhookToken'),
  };
}

export function parseStoredWechatEcloudConfig(value: unknown): StoredWechatEcloudConfig {
  const parsed = parseWechatEcloudConfigInput(value);
  if (!parsed.webhookToken) {
    throw new Error('invalid_wechat_ecloud_config:webhookToken');
  }

  return {
    appId: parsed.appId,
    token: parsed.token,
    baseUrl: parsed.baseUrl,
    webhookToken: parsed.webhookToken,
  };
}

export function ensureStoredWechatEcloudConfig(
  value: unknown,
  createWebhookToken: () => string,
): StoredWechatEcloudConfig {
  const parsed = parseWechatEcloudConfigInput(value);
  return {
    appId: parsed.appId,
    token: parsed.token,
    baseUrl: parsed.baseUrl,
    webhookToken: parsed.webhookToken ?? createWebhookToken(),
  };
}

export function hasWechatEcloudWebhookToken(value: unknown): boolean {
  return Boolean(parseWechatEcloudConfigInput(value).webhookToken);
}

export function buildPublicWechatEcloudConfig(value: unknown): PublicWechatEcloudConfig {
  const parsed = parseWechatEcloudConfigInput(value);
  return {
    appId: parsed.appId,
    baseUrl: parsed.baseUrl,
    callbackPath: WECHAT_ECLOUD_CALLBACK_PATH,
  };
}
