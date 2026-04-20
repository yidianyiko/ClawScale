import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPublicCheckoutUrl,
  PublicCheckoutTokenError,
  issuePublicCheckoutToken,
  verifyPublicCheckoutToken,
} from './coke-public-checkout.js';

function signJwtLikeToken(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

describe('coke-public-checkout helpers', () => {
  afterEach(() => {
    delete process.env.CUSTOMER_JWT_SECRET;
    delete process.env.COKE_JWT_SECRET;
    delete process.env.DOMAIN_CLIENT;
    vi.useRealTimers();
  });

  it('issues and verifies a public checkout token for one customer', () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const token = issuePublicCheckoutToken({ customerId: 'ck_shared_1' });

    expect(verifyPublicCheckoutToken(token)).toMatchObject({
      sub: 'ck_shared_1',
      customerId: 'ck_shared_1',
      tokenType: 'action',
      purpose: 'public_checkout',
    });
  });

  it('falls back to COKE_JWT_SECRET when CUSTOMER_JWT_SECRET is missing', () => {
    process.env.COKE_JWT_SECRET = 'coke-secret';

    const token = issuePublicCheckoutToken({ customerId: 'ck_shared_2' });

    expect(verifyPublicCheckoutToken(token)).toMatchObject({
      sub: 'ck_shared_2',
      customerId: 'ck_shared_2',
      tokenType: 'action',
      purpose: 'public_checkout',
    });
  });

  it('rejects an expired public checkout token', () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T00:00:00.000Z'));
    const token = issuePublicCheckoutToken({ customerId: 'ck_shared_1' });

    vi.setSystemTime(new Date('2026-04-21T00:00:01.000Z'));

    expect(() => verifyPublicCheckoutToken(token)).toThrow('invalid_or_expired_token');
  });

  it('rejects malformed token structure', () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    expect(() => verifyPublicCheckoutToken('not-a-jwt')).toThrow(PublicCheckoutTokenError);
    expect(() => verifyPublicCheckoutToken('a.b')).toThrow(PublicCheckoutTokenError);
  });

  it('rejects tokens with the wrong secret or a tampered signature', () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    const token = issuePublicCheckoutToken({ customerId: 'ck_shared_1' });

    process.env.CUSTOMER_JWT_SECRET = 'different-secret';
    expect(() => verifyPublicCheckoutToken(token)).toThrow(PublicCheckoutTokenError);

    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    expect(() => verifyPublicCheckoutToken(tamperedToken)).toThrow(PublicCheckoutTokenError);
  });

  it('rejects tokens with invalid public checkout claims', () => {
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';

    const wrongPurpose = signJwtLikeToken(
      {
        sub: 'ck_shared_1',
        customerId: 'ck_shared_1',
        tokenType: 'action',
        purpose: 'verify_email',
        iat: 1713571200,
        exp: 1713657600,
      },
      'customer-secret',
    );
    const wrongTokenType = signJwtLikeToken(
      {
        sub: 'ck_shared_1',
        customerId: 'ck_shared_1',
        tokenType: 'access',
        purpose: 'public_checkout',
        iat: 1713571200,
        exp: 1713657600,
      },
      'customer-secret',
    );
    const mismatchedSubject = signJwtLikeToken(
      {
        sub: 'ck_shared_1',
        customerId: 'ck_shared_2',
        tokenType: 'action',
        purpose: 'public_checkout',
        iat: 1713571200,
        exp: 1713657600,
      },
      'customer-secret',
    );

    expect(() => verifyPublicCheckoutToken(wrongPurpose)).toThrow(PublicCheckoutTokenError);
    expect(() => verifyPublicCheckoutToken(wrongTokenType)).toThrow(PublicCheckoutTokenError);
    expect(() => verifyPublicCheckoutToken(mismatchedSubject)).toThrow(PublicCheckoutTokenError);
  });

  it('builds a renewal URL from DOMAIN_CLIENT', () => {
    process.env.DOMAIN_CLIENT = 'https://coke.example/';

    expect(buildPublicCheckoutUrl('signed-token')).toBe(
      'https://coke.example/api/coke/public-checkout?token=signed-token',
    );
  });

  it('falls back to a relative renewal URL when DOMAIN_CLIENT is unset', () => {
    expect(buildPublicCheckoutUrl('signed-token')).toBe(
      '/api/coke/public-checkout?token=signed-token',
    );
  });
});
