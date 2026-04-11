import { describe, expect, it } from 'vitest';

import { normalizeEmail, sha256Hex } from './coke-auth.js';

describe('coke-auth helpers', () => {
  it('normalizes email deterministically', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('hashes strings with sha256 hex', () => {
    expect(sha256Hex('token-123')).toBe(
      '034192845dc489deca291f9f5ae0bb8e5472c991020bf64b3ebc6dec5a1d7e47',
    );
  });
});
