import { describe, expect, it } from 'vitest';

import {
  buildExternalIdentityUniqueWhere,
  normalizeExternalIdentity,
} from './external-identity.js';

describe('external identity helpers', () => {
  it('normalizes WhatsApp wa_id values to digits only', () => {
    expect(
      normalizeExternalIdentity({
        provider: 'whatsapp',
        identityType: 'wa_id',
        rawValue: '+1 (415) 555-0100',
      }),
    ).toEqual({
      provider: 'whatsapp',
      identityType: 'wa_id',
      identityValue: '14155550100',
    });
  });

  it('normalizes whatsapp_evolution wa_id values to digits only', () => {
    expect(
      normalizeExternalIdentity({
        provider: 'whatsapp_evolution',
        identityType: 'wa_id',
        rawValue: '8619917902815@s.whatsapp.net',
      }),
    ).toEqual({
      provider: 'whatsapp_evolution',
      identityType: 'wa_id',
      identityValue: '8619917902815',
    });
  });

  it('normalizes linq phone_number identities to E.164-like values', () => {
    expect(
      normalizeExternalIdentity({
        provider: 'linq',
        identityType: 'phone_number',
        rawValue: '+86 152 017 80593',
      }),
    ).toEqual({
      provider: 'linq',
      identityType: 'phone_number',
      identityValue: '+8615201780593',
    });

    expect(
      normalizeExternalIdentity({
        provider: 'linq',
        identityType: 'phone_number',
        rawValue: '8615201780593',
      }),
    ).toEqual({
      provider: 'linq',
      identityType: 'phone_number',
      identityValue: '+8615201780593',
    });
  });

  it('keeps unexpected linq phone_number identities trimmed when no digits exist', () => {
    expect(
      normalizeExternalIdentity({
        provider: 'linq',
        identityType: 'phone_number',
        rawValue: ' user@example.com ',
      }),
    ).toEqual({
      provider: 'linq',
      identityType: 'phone_number',
      identityValue: 'user@example.com',
    });
  });

  it('keeps non-WhatsApp identities trimmed without phone-number rewriting', () => {
    expect(
      normalizeExternalIdentity({
        provider: 'telegram',
        identityType: 'user_id',
        rawValue: '  U_12345  ',
      }),
    ).toEqual({
      provider: 'telegram',
      identityType: 'user_id',
      identityValue: 'U_12345',
    });
  });

  it('rejects blank provider, identity type, or raw value', () => {
    expect(() =>
      normalizeExternalIdentity({
        provider: '   ',
        identityType: 'user_id',
        rawValue: '123',
      }),
    ).toThrow('provider is required');

    expect(() =>
      normalizeExternalIdentity({
        provider: 'telegram',
        identityType: '   ',
        rawValue: '123',
      }),
    ).toThrow('identityType is required');

    expect(() =>
      normalizeExternalIdentity({
        provider: 'telegram',
        identityType: 'user_id',
        rawValue: '   ',
      }),
    ).toThrow('rawValue is required');
  });

  it('builds the same unique lookup for values that normalize to the same row', () => {
    const lookupA = buildExternalIdentityUniqueWhere(
      normalizeExternalIdentity({
        provider: 'whatsapp',
        identityType: 'wa_id',
        rawValue: '+1 (415) 555-0100',
      }),
    );
    const lookupB = buildExternalIdentityUniqueWhere(
      normalizeExternalIdentity({
        provider: 'whatsapp',
        identityType: 'wa_id',
        rawValue: '14155550100',
      }),
    );

    expect(lookupA).toEqual(lookupB);
    expect(lookupA).toEqual({
      provider_identityType_identityValue: {
        provider: 'whatsapp',
        identityType: 'wa_id',
        identityValue: '14155550100',
      },
    });
  });
});
