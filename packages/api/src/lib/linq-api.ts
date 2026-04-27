const DEFAULT_TIMEOUT_MS = 10_000;

export const LINQ_WEBHOOK_VERSION = '2026-02-03';
export const LINQ_WEBHOOK_EVENTS = ['message.received'] as const;

export interface CreateChatParams {
  from: string;
  to: string[];
  text: string;
}

export interface CreateWebhookSubscriptionParams {
  targetUrl: string;
  phoneNumbers: string[];
}

export interface LinqWebhookSubscription {
  id: string;
  signingSecret: string;
}

function trimRequiredEnv(name: 'LINQ_API_BASE_URL' | 'LINQ_API_KEY'): string {
  const value = process.env[name]?.trim() ?? '';
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function buildBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function withWebhookVersion(targetUrl: string): string {
  const url = new URL(targetUrl);
  url.searchParams.set('version', LINQ_WEBHOOK_VERSION);
  return url.toString();
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'network_error';
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseWebhookSubscription(value: unknown): LinqWebhookSubscription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Linq API response invalid /webhook-subscriptions');
  }

  const record = value as Record<string, unknown>;
  const id = readStringField(record, 'id');
  const signingSecret = readStringField(record, 'signing_secret') ?? readStringField(record, 'signingSecret');
  if (!id || !signingSecret) {
    throw new Error('Linq API response invalid /webhook-subscriptions');
  }

  return { id, signingSecret };
}

export class LinqApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    baseUrl = trimRequiredEnv('LINQ_API_BASE_URL'),
    apiKey = trimRequiredEnv('LINQ_API_KEY'),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = buildBaseUrl(baseUrl);
    this.apiKey = apiKey.trim();
  }

  async createChat(params: CreateChatParams): Promise<unknown> {
    return this.request('/chats', {
      method: 'POST',
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        message: {
          parts: [{ type: 'text', value: params.text }],
        },
      }),
    });
  }

  async createWebhookSubscription(params: CreateWebhookSubscriptionParams): Promise<LinqWebhookSubscription> {
    const response = await this.request('/webhook-subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        target_url: withWebhookVersion(params.targetUrl),
        subscribed_events: [...LINQ_WEBHOOK_EVENTS],
        phone_numbers: params.phoneNumbers,
      }),
    });

    return parseWebhookSubscription(response);
  }

  async deleteWebhookSubscription(subscriptionId: string): Promise<unknown> {
    return this.request(`/webhook-subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`Linq API request failed ${path}: ${readErrorMessage(error)}`);
    }

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(
        body
          ? `Linq API request failed (${response.status}) ${path}: ${body}`
          : `Linq API request failed (${response.status}) ${path}`,
      );
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return response.text();
  }
}
