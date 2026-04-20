import jwt from 'jsonwebtoken';

const PUBLIC_CHECKOUT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '24h';

export interface PublicCheckoutTokenPayload {
  sub: string;
  customerId: string;
  tokenType: 'action';
  purpose: 'public_checkout';
  iat?: number;
  exp?: number;
}

export class PublicCheckoutTokenError extends Error {
  readonly code = 'invalid_or_expired_token';

  constructor() {
    super('invalid_or_expired_token');
    this.name = 'PublicCheckoutTokenError';
  }
}

function readCustomerJwtSecret(): string {
  const secret =
    process.env['CUSTOMER_JWT_SECRET']?.trim() ?? process.env['COKE_JWT_SECRET']?.trim();

  if (!secret) {
    throw new Error('CUSTOMER_JWT_SECRET or COKE_JWT_SECRET is required');
  }

  return secret;
}

export function issuePublicCheckoutToken(input: { customerId: string }): string {
  return jwt.sign(
    {
      sub: input.customerId,
      customerId: input.customerId,
      tokenType: 'action',
      purpose: 'public_checkout',
    },
    readCustomerJwtSecret(),
    { expiresIn: PUBLIC_CHECKOUT_EXPIRES_IN },
  );
}

export function verifyPublicCheckoutToken(token: string): PublicCheckoutTokenPayload {
  let payload: unknown;
  try {
    payload = jwt.verify(token, readCustomerJwtSecret());
  } catch {
    throw new PublicCheckoutTokenError();
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as Record<string, unknown>).sub !== (payload as Record<string, unknown>).customerId ||
    typeof (payload as Record<string, unknown>).sub !== 'string' ||
    typeof (payload as Record<string, unknown>).customerId !== 'string' ||
    (payload as Record<string, unknown>).tokenType !== 'action' ||
    (payload as Record<string, unknown>).purpose !== 'public_checkout' ||
    typeof (payload as Record<string, unknown>).iat !== 'number' ||
    typeof (payload as Record<string, unknown>).exp !== 'number'
  ) {
    throw new PublicCheckoutTokenError();
  }

  if ((payload as Record<string, unknown>).exp <= Math.floor(Date.now() / 1000)) {
    throw new PublicCheckoutTokenError();
  }

  return payload as PublicCheckoutTokenPayload;
}

export function buildPublicCheckoutUrl(token: string): string {
  const domainClient = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  const path = `/api/coke/public-checkout?token=${encodeURIComponent(token)}`;

  return domainClient ? `${domainClient}${path}` : path;
}
