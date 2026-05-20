import { describe, expect, it } from 'vitest';

import {
  buildPublicLinqConfig,
  ensureStoredLinqConfig,
  hasLinqSigningSecret,
  hasLinqWebhookToken,
  normalizeLinqPhoneNumber,
  parseStoredLinqConfig,
} from './linq-config.js';

describe('linq config helpers', () => {
  it('normalizes formatted phone numbers to E.164-like values', () => {
    expect(normalizeLinqPhoneNumber('+1 (321) 310-8456')).toBe('+13213108456');
    expect(normalizeLinqPhoneNumber('13213108456')).toBe('+13213108456');
  });

  it('rejects malformed phone numbers', () => {
    expect(() => normalizeLinqPhoneNumber('not-a-phone')).toThrow('invalid_linq_phone_number');
  });

  it('builds a public config without exposing secrets', () => {
    expect(
      buildPublicLinqConfig({
        fromNumber: '+1 (321) 310-8456',
        webhookToken: 'token_1',
        webhookSubscriptionId: 'sub_1',
        signingSecret: 'secret_1',
      }),
    ).toEqual({
      fromNumber: '+13213108456',
      webhookSubscriptionId: 'sub_1',
    });
  });

  it('backfills missing webhookToken when materializing a stored config', () => {
    expect(
      ensureStoredLinqConfig(
        {
          fromNumber: '+1 (321) 310-8456',
        },
        () => 'generated_token_1',
      ),
    ).toEqual({
      fromNumber: '+13213108456',
      webhookToken: 'generated_token_1',
      webhookSubscriptionId: undefined,
      signingSecret: undefined,
    });
  });

  it('parses connected stored config fields', () => {
    expect(
      parseStoredLinqConfig({
        fromNumber: '13213108456',
        webhookToken: ' token_1 ',
        webhookSubscriptionId: ' sub_1 ',
        signingSecret: ' secret_1 ',
      }),
    ).toEqual({
      fromNumber: '+13213108456',
      webhookToken: 'token_1',
      webhookSubscriptionId: 'sub_1',
      signingSecret: 'secret_1',
    });
  });

  it('detects webhook token presence and treats absent or invalid config as false', () => {
    expect(
      hasLinqWebhookToken({
        fromNumber: '+13213108456',
        webhookToken: 'token_1',
      }),
    ).toBe(true);
    expect(
      hasLinqWebhookToken({
        fromNumber: '+13213108456',
      }),
    ).toBe(false);
    expect(hasLinqWebhookToken({ webhookToken: 'token_1' })).toBe(false);
  });

  it('detects signing secret presence and treats absent or invalid config as false', () => {
    expect(
      hasLinqSigningSecret({
        fromNumber: '+13213108456',
        signingSecret: 'secret_1',
      }),
    ).toBe(true);
    expect(
      hasLinqSigningSecret({
        fromNumber: '+13213108456',
      }),
    ).toBe(false);
    expect(hasLinqSigningSecret({ signingSecret: 'secret_1' })).toBe(false);
  });
});
