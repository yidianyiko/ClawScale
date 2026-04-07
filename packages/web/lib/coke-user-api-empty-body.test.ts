import { afterEach, describe, expect, it, vi } from 'vitest';

const getCokeUserTokenMock = vi.hoisted(() => vi.fn());
const originalCokeApiUrl = process.env['NEXT_PUBLIC_COKE_API_URL'];

vi.mock('./coke-user-auth', () => ({
  getCokeUserToken: () => getCokeUserTokenMock(),
}));

import { cokeUserApi } from './coke-user-api';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (originalCokeApiUrl == null) {
    delete process.env['NEXT_PUBLIC_COKE_API_URL'];
  } else {
    process.env['NEXT_PUBLIC_COKE_API_URL'] = originalCokeApiUrl;
  }
});

describe('cokeUserApi empty-body success handling', () => {
  it('returns undefined instead of throwing when the response body is empty', async () => {
    getCokeUserTokenMock.mockReturnValue(null);
    process.env['NEXT_PUBLIC_COKE_API_URL'] = 'https://coke-bridge.example.com';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 204,
        text: async () => '',
      })) as typeof fetch,
    );

    await expect(cokeUserApi.delete('/user/wechat-channel')).resolves.toBeUndefined();
  });

  it('rejects when a non-2xx response has an empty body', async () => {
    getCokeUserTokenMock.mockReturnValue(null);
    process.env['NEXT_PUBLIC_COKE_API_URL'] = 'https://coke-bridge.example.com';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => '',
      })) as typeof fetch,
    );

    await expect(cokeUserApi.delete('/user/wechat-channel')).rejects.toThrow('HTTP 500');
  });
});
