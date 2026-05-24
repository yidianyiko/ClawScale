/**
 * AI backend bridge adapter.
 *
 * Gateway no longer hosts generic provider backends. The only supported
 * backend type is the custom HTTP adapter used to forward messages into the
 * Coke bridge/runtime boundary.
 */

export type AiBackendType = 'custom';

export interface AiBackendProviderConfig {
  baseUrl?: string;
  authHeader?: string;
  apiKey?: string;
  systemPrompt?: string;
}

interface BackendSpec {
  type: AiBackendType;
  config: AiBackendProviderConfig;
}

interface HistoryAttachment {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
  safeDisplayUrl?: string;
}

type HistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: HistoryAttachment[];
};

interface GenerateOptions {
  backend: BackendSpec;
  history: HistoryMessage[];
  sender?: string;
  platform?: string;
  metadata?: {
    tenantId: string;
    channelId: string;
    endUserId: string;
    conversationId: string;
    gatewayConversationId?: string;
    inboundEventId?: string;
    externalId: string;
    businessConversationKey?: string;
  };
}

export interface BackendReplyPayload {
  text: string;
  businessConversationKey?: string;
  outputId?: string;
  causalInboundEventId?: string;
}

function authHeaders(cfg: AiBackendProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.authHeader) headers['Authorization'] = cfg.authHeader;
  else if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  return headers;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseGatewayReplyPayload(value: unknown): BackendReplyPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const data = value as Record<string, unknown>;
  const text =
    readString(data.text) ??
    readString(data.reply) ??
    readString(data.content) ??
    readString(data.message) ??
    '';
  const businessConversationKey =
    readString(data.businessConversationKey) ?? readString(data.business_conversation_key);
  const outputId = readString(data.outputId) ?? readString(data.output_id);
  const causalInboundEventId =
    readString(data.causalInboundEventId) ?? readString(data.causal_inbound_event_id);

  if (
    businessConversationKey === undefined &&
    outputId === undefined &&
    causalInboundEventId === undefined
  ) {
    return null;
  }

  return {
    text: text.trim(),
    ...(businessConversationKey ? { businessConversationKey } : {}),
    ...(outputId ? { outputId } : {}),
    ...(causalInboundEventId ? { causalInboundEventId } : {}),
  };
}

async function parseResponse(res: Response): Promise<string | BackendReplyPayload> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const body = await res.text();
    throw new Error(`Backend returned non-JSON response (${contentType || 'no content-type'}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  if (typeof data.ok === 'boolean') {
    if (!data.ok) throw new Error(`Backend error: ${data.error ?? 'unknown'}`);
    const gatewayPayload = parseGatewayReplyPayload(data);
    if (gatewayPayload) return gatewayPayload;
    const nestedPayload = parseGatewayReplyPayload(data.reply);
    if (nestedPayload) return nestedPayload;
    return ((data.reply ?? '') as string).trim();
  }

  const gatewayPayload = parseGatewayReplyPayload(data);
  if (gatewayPayload) return gatewayPayload;

  const text = data.reply ?? data.content ?? data.message ?? data.text;
  return typeof text === 'string' ? text.trim() : '';
}

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

function isConnectionError(err: unknown): string | null {
  const code = (err as { cause?: { code?: string } })?.cause?.code
    ?? (err as { code?: string })?.code;
  return code && CONNECTION_ERROR_CODES.has(code) ? code : null;
}

export async function generateReply(
  options: GenerateOptions,
): Promise<string | BackendReplyPayload> {
  const { backend, history, sender, platform, metadata } = options;
  if (backend.type !== 'custom') {
    throw new Error(`Unsupported AI backend type: ${String(backend.type)}`);
  }

  const cfg = backend.config;
  const url = cfg.baseUrl?.trim();
  if (!url) throw new Error('Custom backend: baseUrl is required');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({
        messages: history,
        ...(metadata ? { metadata: { ...metadata, sender, platform } } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Custom backend error: ${res.status} ${errBody.slice(0, 200)}`);
    }

    return await parseResponse(res);
  } catch (err: unknown) {
    const code = isConnectionError(err);
    if (code) {
      console.warn(`[custom] Backend unavailable (${code}), skipping`);
      return `⚠️ The custom backend is currently unavailable (${code}). Please try again later.`;
    }
    throw err;
  }
}
