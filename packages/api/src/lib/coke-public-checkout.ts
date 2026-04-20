import { createHmac, timingSafeEqual } from 'node:crypto';

const PUBLIC_CHECKOUT_TTL_SECONDS = 24 * 60 * 60;
const JWT_HEADER = {
  alg: 'HS256',
  typ: 'JWT',
} as const;

export interface PublicCheckoutTokenPayload {
  sub: string;
  customerId: string;
  tokenType: 'action';
  purpose: 'public_checkout';
  iat: number;
  exp: number;
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

function base64UrlEncode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signJwt(payload: PublicCheckoutTokenPayload, secret: string): string {
  const encodedHeader = base64UrlEncode(JWT_HEADER);
  const encodedPayload = base64UrlEncode(payload);
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function decodeJwt(token: string): {
  header: { alg?: string; typ?: string };
  payload: Partial<PublicCheckoutTokenPayload>;
  signature: string;
  signingInput: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new PublicCheckoutTokenError();
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  try {
    return {
      header: JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
        alg?: string;
        typ?: string;
      },
      payload: JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<PublicCheckoutTokenPayload>,
      signature,
      signingInput: `${encodedHeader}.${encodedPayload}`,
    };
  } catch {
    throw new PublicCheckoutTokenError();
  }
}

export function issuePublicCheckoutToken(input: { customerId: string }): string {
  const iat = Math.floor(Date.now() / 1000);

  return signJwt(
    {
      sub: input.customerId,
      customerId: input.customerId,
      tokenType: 'action',
      purpose: 'public_checkout',
      iat,
      exp: iat + PUBLIC_CHECKOUT_TTL_SECONDS,
    },
    readCustomerJwtSecret(),
  );
}

export function verifyPublicCheckoutToken(token: string): PublicCheckoutTokenPayload {
  const { header, payload, signature, signingInput } = decodeJwt(token);
  const secret = readCustomerJwtSecret();
  const expectedSignature = createHmac('sha256', secret).update(signingInput).digest();
  const actualSignature = Buffer.from(signature, 'base64url');

  try {
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new PublicCheckoutTokenError();
    }

    if (expectedSignature.length !== actualSignature.length) {
      throw new PublicCheckoutTokenError();
    }

    if (!timingSafeEqual(expectedSignature, actualSignature)) {
      throw new PublicCheckoutTokenError();
    }

    if (
      payload.sub !== payload.customerId ||
      typeof payload.sub !== 'string' ||
      typeof payload.customerId !== 'string' ||
      payload.tokenType !== 'action' ||
      payload.purpose !== 'public_checkout' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new PublicCheckoutTokenError();
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new PublicCheckoutTokenError();
    }

    return payload as PublicCheckoutTokenPayload;
  } catch {
    throw new PublicCheckoutTokenError();
  }
}

export function buildPublicCheckoutUrl(token: string): string {
  const domainClient = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  const path = `/api/coke/public-checkout?token=${encodeURIComponent(token)}`;

  return domainClient ? `${domainClient}${path}` : path;
}
