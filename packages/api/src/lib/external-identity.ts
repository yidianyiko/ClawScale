interface NormalizeExternalIdentityInput {
  provider: string;
  identityType: string;
  rawValue: string;
}

export interface NormalizedExternalIdentity {
  provider: string;
  identityType: string;
  identityValue: string;
}

interface ExternalIdentityUniqueWhere {
  provider_identityType_identityValue: NormalizedExternalIdentity;
}

const WHATSAPP_PROVIDERS = new Set(['whatsapp', 'whatsapp_business', 'whatsapp_evolution']);

function requireNonBlank(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error(`${fieldName} is required`);
  }

  return trimmed;
}

function normalizeProvider(provider: string): string {
  return requireNonBlank(provider, 'provider').toLowerCase();
}


function normalizeIdentityType(identityType: string): string {
  return requireNonBlank(identityType, 'identityType').toLowerCase();
}


function normalizeWhatsAppWaId(rawValue: string): string {
  const digitsOnly = rawValue.replace(/\D+/g, '');
  return digitsOnly.length > 0 ? digitsOnly : rawValue.trim();
}

export function normalizeExternalIdentity(
  input: NormalizeExternalIdentityInput,
): NormalizedExternalIdentity {
  const provider = normalizeProvider(input.provider);
  const identityType = normalizeIdentityType(input.identityType);
  const trimmedValue = requireNonBlank(input.rawValue, 'rawValue');

  return {
    provider,
    identityType,
    identityValue:
      WHATSAPP_PROVIDERS.has(provider) && identityType === 'wa_id'
        ? normalizeWhatsAppWaId(trimmedValue)
        : trimmedValue,
  };
}

export function buildExternalIdentityUniqueWhere(
  identity: NormalizedExternalIdentity,
): ExternalIdentityUniqueWhere {
  return {
    provider_identityType_identityValue: identity,
  };
}
