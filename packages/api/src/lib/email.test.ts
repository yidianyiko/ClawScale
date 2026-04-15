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

import { sendCokeEmail } from './email.js';

describe('sendCokeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'noreply@keep4oforever.com';
    process.env.EMAIL_FROM_NAME = 'Coke';
    mocks.sendMock.mockResolvedValue({ data: { id: 'email_123' }, error: null });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
  });

  it('sends through Resend with the formatted sender name', async () => {
    await expect(
      sendCokeEmail({
        to: 'alice@example.com',
        subject: 'Verify your Coke email',
        html: '<p>hello</p>',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.resendCtorMock).toHaveBeenCalledWith('re_test_key');
    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"Coke" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Verify your Coke email',
      html: '<p>hello</p>',
    });
  });

  it('uses the default sender address when EMAIL_FROM is unset', async () => {
    delete process.env.EMAIL_FROM;

    await expect(
      sendCokeEmail({
        to: 'alice@example.com',
        subject: 'Verify your Coke email',
        html: '<p>hello</p>',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendMock).toHaveBeenCalledWith({
      from: '"Coke" <noreply@keep4oforever.com>',
      to: 'alice@example.com',
      subject: 'Verify your Coke email',
      html: '<p>hello</p>',
    });
  });

  it('throws when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(
      sendCokeEmail({
        to: 'alice@example.com',
        subject: 'Verify your Coke email',
        html: '<p>hello</p>',
      }),
    ).rejects.toThrow('resend_config_missing');
  });

  it('throws when Resend returns an API error', async () => {
    mocks.sendMock.mockResolvedValue({ data: null, error: { message: 'invalid from' } });

    await expect(
      sendCokeEmail({
        to: 'alice@example.com',
        subject: 'Verify your Coke email',
        html: '<p>hello</p>',
      }),
    ).rejects.toThrow('resend_send_failed:invalid from');
  });
});
