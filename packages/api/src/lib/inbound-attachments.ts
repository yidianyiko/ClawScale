export const MAX_INBOUND_ATTACHMENTS = 4;
export const MAX_HTTP_URL_LENGTH = 4096;
export const MAX_DATA_URL_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_DATA_URL_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENT_JSON_BYTES = 5 * 1024 * 1024;

const ALLOWED_DATA_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/silk',
  'video/mp4',
  'application/pdf',
]);

const MAX_DISPLAY_FILENAME_LENGTH = 120;

export type InboundAttachment = {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
  safeDisplayUrl: string;
};

export type NormalizeInboundAttachmentsOptions = {
  allowDataUrls?: boolean;
};

export type NormalizeInboundAttachmentsResult = {
  attachments: InboundAttachment[];
  rejected: boolean;
  reason?: 'attachment_limit_exceeded' | 'attachment_payload_too_large';
};

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeUrlInput(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function sanitizeDisplayFilename(value: string): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!sanitized) return 'attachment';
  if (sanitized.toLowerCase().includes('data:')) return 'attachment';
  return sanitized.length > MAX_DISPLAY_FILENAME_LENGTH
    ? sanitized.slice(0, MAX_DISPLAY_FILENAME_LENGTH)
    : sanitized;
}

function buildSafeDisplayUrl(parsed: URL): string {
  const display = new URL(parsed.href);
  display.username = '';
  display.password = '';
  display.search = '';
  display.hash = '';
  return display.href;
}

function parseDataUrl(value: string): { contentType: string; bytes: number } | null {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const contentType = match[1]!.toLowerCase();
  if (!ALLOWED_DATA_CONTENT_TYPES.has(contentType)) return null;
  const payload = match[2]!;
  if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
  const paddingIndex = payload.indexOf('=');
  if (paddingIndex !== -1 && !/^=+$/.test(payload.slice(paddingIndex))) return null;
  const decoded = Buffer.from(payload, 'base64');
  if (decoded.toString('base64') !== payload) return null;
  const bytes = decoded.byteLength;
  return { contentType, bytes };
}

function addBytes(total: number, bytes: number): number {
  const next = total + bytes;
  return next > MAX_ATTACHMENT_JSON_BYTES ? Number.POSITIVE_INFINITY : next;
}

function jsonStringFootprintBytes(value: string): number {
  let total = 2;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return Number.POSITIVE_INFINITY;
    if (codePoint <= 0x1f) {
      total = addBytes(total, 6);
    } else if (char === '"' || char === '\\') {
      total = addBytes(total, 2);
    } else {
      total = addBytes(total, Buffer.byteLength(char, 'utf8'));
    }
    if (!Number.isFinite(total)) return total;
  }
  return total;
}

function boundedJsonFootprintBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null) return 4;

  switch (typeof value) {
    case 'string':
      return jsonStringFootprintBytes(value);
    case 'number':
      return Number.isFinite(value) ? Buffer.byteLength(String(value), 'utf8') : 4;
    case 'boolean':
      return value ? 4 : 5;
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      return Number.POSITIVE_INFINITY;
    case 'object':
      break;
  }

  if (seen.has(value)) return Number.POSITIVE_INFINITY;
  seen.add(value);

  let total = 0;
  if (Array.isArray(value)) {
    total = addBytes(total, 1);
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) total = addBytes(total, 1);
      total = addBytes(total, boundedJsonFootprintBytes(value[index], seen));
      if (!Number.isFinite(total)) return total;
    }
    total = addBytes(total, 1);
    seen.delete(value);
    return total;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return Number.POSITIVE_INFINITY;
  }

  total = addBytes(total, 1);
  let propertyCount = 0;
  const record = value as Record<string, unknown>;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (propertyCount > 0) total = addBytes(total, 1);
    total = addBytes(total, jsonStringFootprintBytes(key));
    total = addBytes(total, 1);
    total = addBytes(total, boundedJsonFootprintBytes(record[key], seen));
    if (!Number.isFinite(total)) return total;
    propertyCount += 1;
  }
  total = addBytes(total, 1);
  seen.delete(value);
  return total;
}

export function normalizeInboundAttachments(
  rawAttachments: unknown,
  options: NormalizeInboundAttachmentsOptions = {},
): NormalizeInboundAttachmentsResult {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) {
    return { attachments: [], rejected: false };
  }
  if (rawAttachments.length > MAX_INBOUND_ATTACHMENTS) {
    return { attachments: [], rejected: true, reason: 'attachment_limit_exceeded' };
  }
  if (boundedJsonFootprintBytes(rawAttachments) > MAX_ATTACHMENT_JSON_BYTES) {
    return { attachments: [], rejected: true, reason: 'attachment_payload_too_large' };
  }

  let totalDataBytes = 0;
  const attachments: InboundAttachment[] = [];
  for (const raw of rawAttachments) {
    const record = readRecord(raw);
    const rawUrl = readString(record?.['url']);
    const url = rawUrl ? normalizeUrlInput(rawUrl) : undefined;
    if (!url) continue;

    const filename = readString(record?.['filename']) ?? 'attachment';
    const displayFilename = sanitizeDisplayFilename(filename);
    const explicitContentType = readString(record?.['contentType']);
    const size = readSize(record?.['size']);

    if (url.startsWith('data:')) {
      if (!options.allowDataUrls) continue;
      const data = parseDataUrl(url);
      if (!data) continue;
      if (data.bytes > MAX_DATA_URL_BYTES) {
        return { attachments: [], rejected: true, reason: 'attachment_payload_too_large' };
      }
      totalDataBytes += data.bytes;
      if (totalDataBytes > MAX_TOTAL_DATA_URL_BYTES) {
        return { attachments: [], rejected: true, reason: 'attachment_payload_too_large' };
      }
      attachments.push({
        url,
        filename,
        contentType: data.contentType,
        safeDisplayUrl: `[inline ${data.contentType} attachment: ${displayFilename}]`,
        size: size ?? data.bytes,
      });
      continue;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (parsed.href.length > MAX_HTTP_URL_LENGTH) continue;
      attachments.push({
        url: parsed.href,
        filename,
        contentType: explicitContentType ?? 'application/octet-stream',
        safeDisplayUrl: buildSafeDisplayUrl(parsed),
        ...(size !== undefined ? { size } : {}),
      });
    } catch {
      continue;
    }
  }

  return { attachments, rejected: false };
}
