import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword } from './password.js';

const ADMIN_JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '7d';

interface AdminJwtPayload {
  sub: string;
  email: string;
  tokenType: 'admin';
  iat?: number;
  exp?: number;
}

interface AdminAuthResult {
  adminId: string;
  email: string;
  isActive: true;
  token: string;
}

export interface AdminSession {
  adminId: string;
  email: string;
  isActive: boolean;
}

interface AuthenticateAdminInput {
  email: string;
  password: string;
}

interface GetAdminSessionInput {
  adminId: string;
}

interface AdminAccountRecord {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
}

interface AdminAccountSessionRecord {
  id: string;
  email: string;
  isActive: boolean;
}

interface AdminAuthClient {
  adminAccount: {
    findUnique(args: { where: { email: string } | { id: string } }): Promise<AdminAccountRecord | AdminAccountSessionRecord | null>;
  };
}

export class AdminAuthError extends Error {
  constructor(public readonly code: 'invalid_credentials' | 'inactive_account') {
    super(code);
    this.name = 'AdminAuthError';
  }
}

function readAdminJwtSecret(): string {
  const secret = process.env['ADMIN_JWT_SECRET']?.trim();
  if (!secret) {
    throw new Error('ADMIN_JWT_SECRET is required');
  }

  return secret;
}

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashAdminPassword(password: string): Promise<string> {
  return hashPassword(password);
}

function signAdminToken(input: { adminId: string; email: string }): string {
  return jwt.sign(
    {
      sub: input.adminId,
      email: input.email,
      tokenType: 'admin',
    } satisfies Omit<AdminJwtPayload, 'iat' | 'exp'>,
    readAdminJwtSecret(),
    { expiresIn: ADMIN_JWT_EXPIRES_IN },
  );
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  try {
    const payload = jwt.verify(token, readAdminJwtSecret()) as AdminJwtPayload;
    if (payload.tokenType !== 'admin') {
      throw new Error('invalid_or_expired_token');
    }

    return payload;
  } catch {
    throw new Error('invalid_or_expired_token');
  }
}

export async function authenticateAdmin(
  client: AdminAuthClient,
  input: AuthenticateAdminInput,
): Promise<AdminAuthResult> {
  const email = normalizeAdminEmail(input.email);
  const account = await client.adminAccount.findUnique({
    where: { email },
  });

  if (!account || !('passwordHash' in account)) {
    throw new AdminAuthError('invalid_credentials');
  }

  const validPassword = await verifyPassword(input.password, account.passwordHash);
  if (!validPassword) {
    throw new AdminAuthError('invalid_credentials');
  }

  if (!account.isActive) {
    throw new AdminAuthError('inactive_account');
  }

  return {
    adminId: account.id,
    email: account.email,
    isActive: true,
    token: signAdminToken({
      adminId: account.id,
      email: account.email,
    }),
  };
}

export async function getAdminSession(
  client: AdminAuthClient,
  input: GetAdminSessionInput,
): Promise<AdminSession | null> {
  const account = await client.adminAccount.findUnique({
    where: { id: input.adminId },
  });

  if (!account) {
    return null;
  }

  return {
    adminId: account.id,
    email: account.email,
    isActive: account.isActive,
  };
}
