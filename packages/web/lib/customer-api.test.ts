import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerApiConfigurationError, customerApi, getCustomerApiBase } from './customer-api';

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
    delete (globalThis as typeof globalThis & { window?: Window }).window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe('customer api base helpers', () => {
  it('prefers the dedicated coke api url and otherwise falls back to the shared public api url', () => {
    process.env['NEXT_PUBLIC_COKE_API_URL'] = 'https://coke-bridge.example.com';
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    expect(getCustomerApiBase()).toBe('https://coke-bridge.example.com');

    delete process.env['NEXT_PUBLIC_COKE_API_URL'];
    expect(getCustomerApiBase()).toBe('https://gateway.example.com');
  });

  it('throws a configuration error when no public api url is configured', () => {
    delete process.env['NEXT_PUBLIC_COKE_API_URL'];
    delete process.env['NEXT_PUBLIC_API_URL'];

    expect(() => getCustomerApiBase()).toThrow(CustomerApiConfigurationError);
  });
});

describe('customerApi', () => {
  it('calls neutral auth endpoints with the stored customer token', async () => {
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
      text: async () => JSON.stringify({ ok: true, data: { email: 'alice@example.com' } }),
    }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await expect(customerApi.get('/api/auth/me')).resolves.toEqual({
      ok: true,
      data: { email: 'alice@example.com' },
    });

    expect(fetchMock).toHaveBeenCalledWith('https://gateway.example.com/api/auth/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer customer-token',
      },
      body: undefined,
    });
  });

  it('treats an empty successful body as undefined for delete responses', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => null),
        },
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await expect(customerApi.delete('/api/customer/channels/wechat-personal')).resolves.toBeUndefined();
  });

  it('throws the HTTP status when a failed response has an empty body', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => null),
        },
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await expect(customerApi.delete('/api/customer/channels/wechat-personal')).rejects.toThrow('HTTP 500');
  });
});
