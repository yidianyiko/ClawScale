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
