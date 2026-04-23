import { sendEmail } from './email.js';

export interface SendCustomerVerificationEmailInput {
  to: string;
  email: string;
  token: string;
}

export interface SendCustomerPasswordResetEmailInput {
  to: string;
  token: string;
}

export interface SendCustomerClaimEmailInput {
  to: string;
  token: string;
}

function getDomainClient(): string {
  return process.env['DOMAIN_CLIENT']?.replace(/\/$/, '') ?? '';
}

function getVerifyEmailUrl(token: string, email: string): string {
  return `${getDomainClient()}/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

function getResetPasswordUrl(token: string): string {
  return `${getDomainClient()}/auth/reset-password?token=${encodeURIComponent(token)}`;
}

function getClaimUrl(token: string): string {
  return `${getDomainClient()}/auth/claim?token=${encodeURIComponent(token)}`;
}

export async function sendCustomerVerificationEmail(
  input: SendCustomerVerificationEmailInput,
): Promise<void> {
  await sendEmail({
    to: input.to,
    subject: 'Verify your email',
    html: `<a href="${getVerifyEmailUrl(input.token, input.email)}">Verify your email</a>`,
  });
}

export async function sendCustomerPasswordResetEmail(
  input: SendCustomerPasswordResetEmailInput,
): Promise<void> {
  await sendEmail({
    to: input.to,
    subject: 'Reset your password',
    html: `<a href="${getResetPasswordUrl(input.token)}">Reset your password</a>`,
  });
}

export async function sendCustomerClaimEmail(input: SendCustomerClaimEmailInput): Promise<void> {
  await sendEmail({
    to: input.to,
    subject: 'Claim your account',
    html: `<a href="${getClaimUrl(input.token)}">Claim your account</a>`,
  });
}
