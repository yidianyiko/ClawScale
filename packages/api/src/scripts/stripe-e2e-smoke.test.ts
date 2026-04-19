import { describe, expect, it } from 'vitest';

import {
  assertPostPaymentSubscription,
  assertPrePaymentSubscription,
  extractCheckoutSessionId,
  isRetriableRequestError,
} from './stripe-e2e-smoke.js';

describe('stripe e2e smoke helpers', () => {
  it('extracts the checkout session id from a hosted checkout url', () => {
    expect(
      extractCheckoutSessionId(
        'https://checkout.stripe.com/c/pay/cs_test_a1wmqjWFOTN9y1x7qUGftnBf0TO4X6dg4Msjf2FBAGkdqZtNXP1iV6tS0c#fidkdWxOYHwnPyd1blppbHNgWjA0Sg',
      ),
    ).toBe('cs_test_a1wmqjWFOTN9y1x7qUGftnBf0TO4X6dg4Msjf2FBAGkdqZtNXP1iV6tS0c');
  });

  it('rejects non-checkout urls', () => {
    expect(() =>
      extractCheckoutSessionId('https://coke.keep4oforever.com/coke/payment-success'),
    ).toThrow('checkout session');
  });

  it('accepts the expected pre-payment subscription state', () => {
    expect(() =>
      assertPrePaymentSubscription({
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: true,
        subscriptionExpiresAt: '2026-04-11T00:00:00.000Z',
        accountAccessAllowed: true,
        accountAccessDeniedReason: null,
        renewalUrl: 'https://coke.keep4oforever.com/coke/renew',
      }),
    ).not.toThrow();
  });

  it('rejects a pre-payment state that is already blocked', () => {
    expect(() =>
      assertPrePaymentSubscription({
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: false,
        subscriptionExpiresAt: null,
        accountAccessAllowed: false,
        accountAccessDeniedReason: 'subscription_required',
        renewalUrl: 'https://coke.keep4oforever.com/coke/renew',
      }),
    ).toThrow('before payment');
  });

  it('accepts the expected post-payment subscription state', () => {
    expect(() =>
      assertPostPaymentSubscription({
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: true,
        subscriptionExpiresAt: '2026-05-19T15:43:15.000Z',
        accountAccessAllowed: true,
        accountAccessDeniedReason: null,
        renewalUrl: 'https://coke.keep4oforever.com/coke/renew',
      }),
    ).not.toThrow();
  });

  it('rejects a post-payment state without an expiry timestamp', () => {
    expect(() =>
      assertPostPaymentSubscription({
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: true,
        subscriptionExpiresAt: null,
        accountAccessAllowed: true,
        accountAccessDeniedReason: null,
        renewalUrl: 'https://coke.keep4oforever.com/coke/renew',
      }),
    ).toThrow('after payment');
  });

  it('treats fetch timeout errors as retriable', () => {
    const error = new TypeError('fetch failed');
    Object.assign(error, {
      cause: {
        code: 'ETIMEDOUT',
      },
    });

    expect(isRetriableRequestError(error)).toBe(true);
  });

  it('does not retry ordinary application errors', () => {
    expect(isRetriableRequestError(new Error('bad request'))).toBe(false);
  });
});
