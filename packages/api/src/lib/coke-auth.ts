import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const COKE_JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '7d';

interface CokeJwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
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

export function signCokeToken(payload: Omit<CokeJwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, readCokeJwtSecret(), { expiresIn: COKE_JWT_EXPIRES_IN });
}

export function verifyCokeToken(token: string): CokeJwtPayload {
  return jwt.verify(token, readCokeJwtSecret()) as CokeJwtPayload;
}
