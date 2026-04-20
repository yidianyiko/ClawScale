import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPublicCheckoutUrl,
  issuePublicCheckoutToken,
  verifyPublicCheckoutToken,
} from './coke-public-checkout.js';

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
