import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMock: vi.fn(),
  resendCtorMock: vi.fn(() => ({
    emails: {
      send: mocks.sendMock,
    },
  })),
}));

vi.mock('resend', () => ({
  Resend: mocks.resendCtorMock,
}));

import { sendCustomerClaimEmail, sendCustomerPasswordResetEmail, sendCustomerVerificationEmail } from './customer-email.js';
import { sendCokeEmail, sendEmail } from './email.js';

describe('email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'noreply@keep4oforever.com';
    process.env.EMAIL_FROM_NAME = 'ClawScale';
    process.env.DOMAIN_CLIENT = 'https://clawscale.example';
    mocks.sendMock.mockResolvedValue({ data: { id: 'email_123' }, error: null });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.DOMAIN_CLIENT;
  });

  it('sends through Resend with the formatted sender name', async () => {
    await expect(
      sendEmail({
        to: 'alice@example.com',
        subject: 'Verify your email',
        html: '<p>hello</p>',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.resendCtorMock).toHaveBeenCalledWith('re_test_key');
    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"ClawScale" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Verify your email',
      html: '<p>hello</p>',
    });
  });

  it('uses the default sender address when EMAIL_FROM is unset', async () => {
    delete process.env.EMAIL_FROM;

    await expect(
      sendEmail({
        to: 'alice@example.com',
        subject: 'Verify your email',
        html: '<p>hello</p>',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"ClawScale" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Verify your email',
      html: '<p>hello</p>',
    });
  });

  it('throws when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(
      sendEmail({
        to: 'alice@example.com',
        subject: 'Verify your email',
        html: '<p>hello</p>',
      }),
    ).rejects.toThrow('resend_config_missing');
  });

  it('throws when Resend returns an API error', async () => {
    mocks.sendMock.mockResolvedValue({ data: null, error: { message: 'invalid from' } });

    await expect(
      sendEmail({
        to: 'alice@example.com',
        subject: 'Verify your email',
        html: '<p>hello</p>',
      }),
    ).rejects.toThrow('resend_send_failed:invalid from');
  });

  it('builds a neutral verification email without Coke route names', async () => {
    await expect(
      sendCustomerVerificationEmail({
        to: 'alice@example.com',
        email: 'alice@example.com',
        token: 'verify-token',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"ClawScale" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Verify your email',
      html: expect.stringContaining(
        'https://clawscale.example/auth/verify-email?token=verify-token&email=alice%40example.com',
      ),
    });
    expect(mocks.sendMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Coke'),
      }),
    );
  });

  it('builds a neutral password reset email without Coke route names', async () => {
    await expect(
      sendCustomerPasswordResetEmail({
        to: 'alice@example.com',
        token: 'reset-token',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"ClawScale" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Reset your password',
      html: expect.stringContaining(
        'https://clawscale.example/auth/reset-password?token=reset-token',
      ),
    });
    expect(mocks.sendMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('/coke/'),
      }),
    );
  });

  it('builds a neutral claim email without unused continuation fields', async () => {
    await expect(
      sendCustomerClaimEmail({
        to: 'alice@example.com',
        token: 'claim-token',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"ClawScale" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Claim your account',
      html: expect.stringContaining(
        'https://clawscale.example/auth/claim?token=claim-token',
      ),
    });
  });

  it('keeps sendCokeEmail as a compatibility alias', async () => {
    await expect(
      sendCokeEmail({
        to: 'alice@example.com',
        subject: 'Compatibility subject',
        html: '<p>compat</p>',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"ClawScale" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Compatibility subject',
      html: '<p>compat</p>',
    });
  });
});
