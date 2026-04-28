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

function parseDataUrl(value: string): { contentType: string; bytes: number } | null {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const contentType = match[1]!.toLowerCase();
  if (!ALLOWED_DATA_CONTENT_TYPES.has(contentType)) return null;
  const bytes = Buffer.from(match[2]!, 'base64').byteLength;
  return { contentType, bytes };
}

function jsonFootprintBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
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
  if (jsonFootprintBytes(rawAttachments) > MAX_ATTACHMENT_JSON_BYTES) {
    return { attachments: [], rejected: true, reason: 'attachment_payload_too_large' };
  }

  let totalDataBytes = 0;
  const attachments: InboundAttachment[] = [];
  for (const raw of rawAttachments) {
    const record = readRecord(raw);
    const url = readString(record?.['url']);
    if (!url) continue;

    const filename = readString(record?.['filename']) ?? 'attachment';
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
        safeDisplayUrl: `[inline ${data.contentType} attachment: ${filename}]`,
        size: size ?? data.bytes,
      });
      continue;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (url.length > MAX_HTTP_URL_LENGTH) continue;
      attachments.push({
        url,
        filename,
        contentType: explicitContentType ?? 'application/octet-stream',
        safeDisplayUrl: url,
        ...(size !== undefined ? { size } : {}),
      });
    } catch {
      continue;
    }
  }

  return { attachments, rejected: false };
}
