import { getCokeUserToken } from './coke-user-auth';

export class CokeUserApiConfigurationError extends Error {
  constructor() {
    super('Coke API base URL is not configured');
    this.name = 'CokeUserApiConfigurationError';
  }
}

export function getCokeUserApiBase(): string {
  const base = process.env['NEXT_PUBLIC_COKE_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (!base) {
    throw new CokeUserApiConfigurationError();
  }
  return base;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getCokeUserToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${getCokeUserApiBase()}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok && text.trim() === '') {
    throw new Error(`HTTP ${res.status}`);
  }

  if (res.ok && text.trim() === '') {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

export const cokeUserApi = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
