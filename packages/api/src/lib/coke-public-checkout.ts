import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PUBLIC_CHECKOUT_EXPIRES_IN = '24h';

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

type JsonWebTokenModule = {
  sign(payload: Record<string, unknown>, secret: string, options?: { expiresIn?: string }): string;
  verify(token: string, secret: string): unknown;
};

let jwtModule: JsonWebTokenModule | null = null;

function readCustomerJwtSecret(): string {
  const secret =
    process.env['CUSTOMER_JWT_SECRET']?.trim() ?? process.env['COKE_JWT_SECRET']?.trim();

  if (!secret) {
    throw new Error('CUSTOMER_JWT_SECRET or COKE_JWT_SECRET is required');
  }

  return secret;
}

function findJsonWebTokenPackageDir(): string | null {
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let currentDir = startDir;

  while (true) {
    const localNodeModules = path.join(currentDir, 'node_modules');
    const directPackageDir = path.join(localNodeModules, 'jsonwebtoken');
    if (fs.existsSync(path.join(directPackageDir, 'package.json'))) {
      return directPackageDir;
    }

    const pnpmDir = path.join(localNodeModules, '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      for (const entry of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('jsonwebtoken@')) {
          continue;
        }

        const packageDir = path.join(pnpmDir, entry.name, 'node_modules', 'jsonwebtoken');
        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
          return packageDir;
        }
      }
    }

    const gatewayDir = path.join(currentDir, 'gateway');
    const gatewayNodeModules = path.join(gatewayDir, 'node_modules');
    const gatewayPackageDir = path.join(gatewayNodeModules, 'jsonwebtoken');
    if (fs.existsSync(path.join(gatewayPackageDir, 'package.json'))) {
      return gatewayPackageDir;
    }

    const gatewayPnpmDir = path.join(gatewayNodeModules, '.pnpm');
    if (fs.existsSync(gatewayPnpmDir)) {
      for (const entry of fs.readdirSync(gatewayPnpmDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('jsonwebtoken@')) {
          continue;
        }

        const packageDir = path.join(gatewayPnpmDir, entry.name, 'node_modules', 'jsonwebtoken');
        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
          return packageDir;
        }
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function loadJsonWebToken(): JsonWebTokenModule {
  if (jwtModule) {
    return jwtModule;
  }

  const require = createRequire(import.meta.url);

  try {
    jwtModule = require('jsonwebtoken') as JsonWebTokenModule;
    return jwtModule;
  } catch {
    const packageDir = findJsonWebTokenPackageDir();
    if (!packageDir) {
      throw new Error('jsonwebtoken package is required');
    }

    jwtModule = require(packageDir) as JsonWebTokenModule;
    return jwtModule;
  }
}

export function issuePublicCheckoutToken(input: { customerId: string }): string {
  const jwt = loadJsonWebToken();

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
  const jwt = loadJsonWebToken();

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
