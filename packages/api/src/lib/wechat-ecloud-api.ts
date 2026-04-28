const DEFAULT_TIMEOUT_MS = 10_000;

function buildBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizeErrorText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function readProviderMessage(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const message = value['msg'] ?? value['message'];
  return typeof message === 'string' && message.trim() ? sanitizeErrorText(message) : undefined;
}

async function readSafeErrorDetail(response: Response): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return '';
  }

  if (!text.trim()) {
    return '';
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const providerMessage = readProviderMessage(parsed);
    if (providerMessage) {
      return providerMessage;
    }
  } catch {
    // Fall through to a bounded text excerpt.
  }

  return sanitizeErrorText(text);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'network_error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class WechatEcloudApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendText(appId: string, toWxid: string, content: string): Promise<unknown> {
    return this.request('/gewe/v2/api/message/postText', {
      method: 'POST',
      body: JSON.stringify({ appId, toWxid, content }),
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${buildBaseUrl(this.baseUrl)}${path}`, {
        ...init,
        headers: {
          'X-GEWE-TOKEN': this.token,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`Ecloud API request failed ${path}: ${readErrorMessage(error)}`);
    }

    if (!response.ok) {
      const detail = await readSafeErrorDetail(response);
      throw new Error(
        detail
          ? `Ecloud API request failed (${response.status}) ${path}: ${detail}`
          : `Ecloud API request failed (${response.status}) ${path}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`Ecloud API request failed ${path}: invalid_json:${readErrorMessage(error)}`);
    }

    if (!isRecord(body) || body['ret'] !== 200) {
      const providerMessage = readProviderMessage(body);
      const message = providerMessage ? `: ${providerMessage}` : '';
      throw new Error(`Ecloud API request failed ${path}${message}`);
    }

    return body;
  }
}
