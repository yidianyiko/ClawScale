import { afterEach, describe, expect, it } from 'vitest';

import { normalizeEmail, sha256Hex, signCokeToken, verifyCokeToken } from './coke-auth.js';

describe('coke-auth helpers', () => {
  afterEach(() => {
    delete process.env.COKE_JWT_SECRET;
  });

  it('normalizes email deterministically', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('hashes strings with sha256 hex', () => {
    expect(sha256Hex('token-123')).toBe(
      '034192845dc489deca291f9f5ae0bb8e5472c991020bf64b3ebc6dec5a1d7e47',
    );
  });

  it('fails fast when COKE_JWT_SECRET is missing', () => {
    delete process.env.COKE_JWT_SECRET;

    expect(() =>
      signCokeToken({
        sub: 'acct_1',
        email: 'alice@example.com',
      }),
    ).toThrow('COKE_JWT_SECRET is required');

    expect(() => verifyCokeToken('not-a-token')).toThrow('COKE_JWT_SECRET is required');
  });
});
