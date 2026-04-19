const DEFAULT_TIMEOUT_MS = 10_000;
const EVOLUTION_WEBHOOK_EVENTS = ['MESSAGES_UPSERT'] as const;

export interface EvolutionWebhookConfig {
  enabled: boolean;
  url: string;
  events: string[];
}

function trimRequiredEnv(name: 'EVOLUTION_API_BASE_URL' | 'EVOLUTION_API_KEY'): string {
  const value = process.env[name]?.trim() ?? '';
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function buildBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
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

export class EvolutionApiClient {
  constructor(
    private readonly baseUrl = trimRequiredEnv('EVOLUTION_API_BASE_URL'),
    private readonly apiKey = trimRequiredEnv('EVOLUTION_API_KEY'),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async setWebhook(instanceName: string, url: string): Promise<unknown> {
    return this.request(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        url,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
        webhookByEvents: false,
        webhookBase64: false,
      }),
    });
  }

  async clearWebhook(instanceName: string): Promise<unknown> {
    return this.request(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        enabled: false,
        url: 'https://invalid.local/disabled',
        events: [...EVOLUTION_WEBHOOK_EVENTS],
        webhookByEvents: false,
        webhookBase64: false,
      }),
    });
  }

  async sendText(instanceName: string, number: string, text: string): Promise<unknown> {
    return this.request(`/message/sendText/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ number, text }),
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${buildBaseUrl(this.baseUrl)}${path}`, {
        ...init,
        headers: {
          apikey: this.apiKey,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`Evolution API request failed ${path}: ${readErrorMessage(error)}`);
    }

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(
        body
          ? `Evolution API request failed (${response.status}) ${path}: ${body}`
          : `Evolution API request failed (${response.status}) ${path}`,
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

export { EVOLUTION_WEBHOOK_EVENTS };
