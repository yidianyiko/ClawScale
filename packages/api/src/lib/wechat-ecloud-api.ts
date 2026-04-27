const DEFAULT_TIMEOUT_MS = 10_000;

function buildBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
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
      const body = await readErrorBody(response);
      throw new Error(
        body
          ? `Ecloud API request failed (${response.status}) ${path}: ${body}`
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
      const message = isRecord(body) && typeof body['msg'] === 'string' ? `: ${body['msg']}` : '';
      throw new Error(`Ecloud API request failed ${path}${message}`);
    }

    return body;
  }
}
