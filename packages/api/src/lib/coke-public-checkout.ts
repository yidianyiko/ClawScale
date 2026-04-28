import jwt from 'jsonwebtoken';

const PUBLIC_CHECKOUT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '24h';

interface PublicCheckoutTokenPayload {
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
  const secret = process.env['CUSTOMER_JWT_SECRET']?.trim();

  if (!secret) {
    throw new Error('CUSTOMER_JWT_SECRET is required');
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

  const payloadRecord = payload as Record<string, unknown>;

  if (
    !payload ||
    typeof payload !== 'object' ||
    payloadRecord.sub !== payloadRecord.customerId ||
    typeof payloadRecord.sub !== 'string' ||
    typeof payloadRecord.customerId !== 'string' ||
    payloadRecord.tokenType !== 'action' ||
    payloadRecord.purpose !== 'public_checkout' ||
    typeof payloadRecord.iat !== 'number' ||
    typeof payloadRecord.exp !== 'number'
  ) {
    throw new PublicCheckoutTokenError();
  }

  if (payloadRecord.exp <= Math.floor(Date.now() / 1000)) {
    throw new PublicCheckoutTokenError();
  }

  return {
    sub: payloadRecord.sub,
    customerId: payloadRecord.customerId,
    tokenType: 'action',
    purpose: 'public_checkout',
    iat: payloadRecord.iat,
    exp: payloadRecord.exp,
  };
}

export function buildPublicCheckoutUrl(token: string): string {
  const domainClient = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  const path = `/api/public/subscription-checkout?token=${encodeURIComponent(token)}`;

  return domainClient ? `${domainClient}${path}` : path;
}
