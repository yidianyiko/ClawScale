import { getCokeUserToken } from './coke-user-auth';

export function getCokeUserApiBase(): string {
  return process.env['NEXT_PUBLIC_COKE_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? '';
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

  return (await res.json()) as T;
}

export const cokeUserApi = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};
