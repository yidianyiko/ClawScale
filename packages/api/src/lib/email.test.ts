import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  createTransportMock: vi.fn(() => ({
    sendMail: mocks.sendMailMock,
  })),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.createTransportMock,
  },
}));

import { sendCokeEmail } from './email.js';

describe('sendCokeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('mailgun down', { status: 500 })));
    process.env.MAILGUN_API_KEY = 'mg-key';
    process.env.MAILGUN_DOMAIN = 'mg.example.com';
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_PORT = '587';
    process.env.EMAIL_USERNAME = 'smtp-user';
    process.env.EMAIL_PASSWORD = 'smtp-pass';
    process.env.EMAIL_FROM = 'noreply@coke.app';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_PORT;
    delete process.env.EMAIL_USERNAME;
    delete process.env.EMAIL_PASSWORD;
    delete process.env.EMAIL_FROM;
  });

  it('falls back to SMTP when Mailgun send fails', async () => {
    await expect(
      sendCokeEmail({
        to: 'alice@example.com',
        subject: 'Verify your email',
        html: '<p>hello</p>',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.createTransportMock).toHaveBeenCalledOnce();
    expect(mocks.sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@coke.app',
      to: 'alice@example.com',
      subject: 'Verify your email',
      html: '<p>hello</p>',
    });
  });

  it('rethrows the Mailgun error when SMTP fallback is unavailable', async () => {
    delete process.env.EMAIL_HOST;

    await expect(
      sendCokeEmail({
        to: 'alice@example.com',
        subject: 'Verify your email',
        html: '<p>hello</p>',
      }),
    ).rejects.toThrow('mailgun_send_failed:500');

    expect(mocks.createTransportMock).not.toHaveBeenCalled();
    expect(mocks.sendMailMock).not.toHaveBeenCalled();
  });
});
