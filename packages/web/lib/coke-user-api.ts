import { getCokeUserToken } from './coke-user-auth';

const BASE = process.env['NEXT_PUBLIC_COKE_API_URL'] ?? 'http://127.0.0.1:8090';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getCokeUserToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
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
