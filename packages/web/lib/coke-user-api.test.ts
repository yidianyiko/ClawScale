import { afterEach, describe, expect, it } from 'vitest';
import { getCokeUserApiBase } from './coke-user-api';

const originalCokeApiUrl = process.env['NEXT_PUBLIC_COKE_API_URL'];
const originalApiUrl = process.env['NEXT_PUBLIC_API_URL'];

afterEach(() => {
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
});

describe('getCokeUserApiBase', () => {
  it('prefers the dedicated coke api url and otherwise falls back to the shared public api url', () => {
    process.env['NEXT_PUBLIC_COKE_API_URL'] = 'https://coke-bridge.example.com';
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    expect(getCokeUserApiBase()).toBe('https://coke-bridge.example.com');

    delete process.env['NEXT_PUBLIC_COKE_API_URL'];
    expect(getCokeUserApiBase()).toBe('https://gateway.example.com');
  });

  it('returns an empty base instead of localhost defaults when no public api url is configured', () => {
    delete process.env['NEXT_PUBLIC_COKE_API_URL'];
    delete process.env['NEXT_PUBLIC_API_URL'];

    expect(getCokeUserApiBase()).toBe('');
  });
});
