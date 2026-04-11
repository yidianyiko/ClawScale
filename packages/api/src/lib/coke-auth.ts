import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const COKE_JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '7d';
const BCRYPT_ROUNDS = 10;

export interface CokeJwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface VerifyTokenIssued {
  plainToken: string;
  tokenHash: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readCokeJwtSecret(): string {
  const secret = process.env['COKE_JWT_SECRET']?.trim();
  if (!secret) {
    throw new Error('COKE_JWT_SECRET is required');
  }

  return secret;
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function issueVerifyToken(): VerifyTokenIssued {
  const plainToken = crypto.randomBytes(32).toString('hex');
  return {
    plainToken,
    tokenHash: sha256Hex(plainToken),
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signCokeToken(payload: Omit<CokeJwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, readCokeJwtSecret(), { expiresIn: COKE_JWT_EXPIRES_IN });
}

export function verifyCokeToken(token: string): CokeJwtPayload {
  return jwt.verify(token, readCokeJwtSecret()) as CokeJwtPayload;
}
