import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchUserLink, openLinkSession, sendFriendRequest } from './user-link-api';

const originalCokeApiUrl = process.env['NEXT_PUBLIC_COKE_API_URL'];
const originalApiUrl = process.env['NEXT_PUBLIC_API_URL'];
const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (originalCokeApiUrl == null) {
    delete process.env['NEXT_PUBLIC_COKE_API_URL'];
  } else {
    process.env['NEXT_PUBLIC_COKE_API_URL'] = originalCokeApiUrl;
  }

  if (originalApiUrl == null) {
    delete process.env['NEXT_PUBLIC_API_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_URL'] = originalApiUrl;
  }

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window');
  } else {
    globalThis.window = originalWindow;
  }
});

describe('user-link api helpers', () => {
  it('fetches a public user link without opening a session', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          code: 'abc',
          status: 'active',
          profile: { displayName: 'Coach A', tagline: 'Strength coach', avatarUrl: null },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(fetchUserLink('abc')).resolves.toEqual({
      ok: true,
      data: {
        code: 'abc',
        status: 'active',
        profile: { displayName: 'Coach A', tagline: 'Strength coach', avatarUrl: null },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://gateway.example.com/api/public/user-links/abc', {
      cache: 'no-store',
    });
  });

  it('opens a public link session', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          token: 'session-token',
          targetAccountId: 'acct_a',
          expiresAt: '2026-06-21T00:00:00.000Z',
          loginUrl: '/auth/login?next=%2Fu%2Fabc%3Flink_session%3Dsession-token',
          registerUrl: '/auth/register?next=%2Fu%2Fabc%3Flink_session%3Dsession-token',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(openLinkSession('abc')).resolves.toMatchObject({
      ok: true,
      data: { token: 'session-token', targetAccountId: 'acct_a' },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://gateway.example.com/api/public/user-links/abc/sessions', {
      method: 'POST',
      cache: 'no-store',
    });
  });

  it('does not synthesize missing link-session fields from legacy responses', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          token: 'session-token',
          nextUrl: '/auth/login?next=%2Fu%2Fabc%3Flink_session%3Dsession-token',
          registerUrl: '/auth/register?next=%2Fu%2Fabc%3Flink_session%3Dsession-token',
          expiresAt: '2026-06-21T00:00:00.000Z',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(openLinkSession('abc')).resolves.toEqual({
      ok: false,
      error: 'link_session_not_opened',
    });
  });

  it('posts a friend request for a preserved link session', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn((key: string) => (key === 'customer_token' ? 'customer-token' : null)),
        },
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: { id: 'fr_1', status: 'pending' } }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(sendFriendRequest({ token: 'session/token', message: 'Let us connect' })).resolves.toEqual({
      ok: true,
      data: { id: 'fr_1', status: 'pending' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/api/public/link-sessions/session%2Ftoken/friend-requests',
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer customer-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Let us connect' }),
      },
    );
  });

  it('returns a failed friend-request result when fetch rejects', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn((key: string) => (key === 'customer_token' ? 'customer-token' : null)),
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch);

    await expect(sendFriendRequest({ token: 'session-token', message: 'Let us connect' })).resolves.toEqual({
      ok: false,
      error: 'friend_request_failed',
    });
  });
});
