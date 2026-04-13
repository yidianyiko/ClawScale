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
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('mailgun down', { status: 500 })));
    process.env.MAILGUN_API_KEY = 'mg-key';
    process.env.MAILGUN_DOMAIN = 'mg.example.com';
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_PORT = '587';
    process.env.EMAIL_USERNAME = 'smtp-user';
    process.env.EMAIL_PASSWORD = 'smtp-pass';
    process.env.EMAIL_FROM = 'noreply@coke.app';
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.EMAIL_SERVICE;
    delete process.env.EMAIL_ENCRYPTION;
    delete process.env.EMAIL_ENCRYPTION_HOSTNAME;
    delete process.env.EMAIL_ALLOW_SELFSIGNED;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_PORT;
    delete process.env.EMAIL_USERNAME;
    delete process.env.EMAIL_PASSWORD;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.EMAIL_SERVICE;
    delete process.env.EMAIL_ENCRYPTION;
    delete process.env.EMAIL_ENCRYPTION_HOSTNAME;
    delete process.env.EMAIL_ALLOW_SELFSIGNED;
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

  it('supports SMTP service mode and formatted sender names', async () => {
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.EMAIL_HOST;
    process.env.EMAIL_SERVICE = 'gmail';
    process.env.EMAIL_FROM_NAME = 'Coke';
    process.env.EMAIL_ENCRYPTION = 'starttls';
    process.env.EMAIL_ENCRYPTION_HOSTNAME = 'smtp.resend.com';
    process.env.EMAIL_ALLOW_SELFSIGNED = 'true';

    await sendCokeEmail({
      to: 'alice@example.com',
      subject: 'Verify your email',
      html: '<p>hello</p>',
    });

    expect(mocks.createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'gmail',
        secure: false,
        requireTls: true,
        tls: {
          rejectUnauthorized: false,
          servername: 'smtp.resend.com',
        },
      }),
    );
    expect(mocks.sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Coke" <noreply@coke.app>',
      }),
    );
  });

  it('warns and omits SMTP auth when only one credential is set', async () => {
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.EMAIL_PASSWORD;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sendCokeEmail({
      to: 'alice@example.com',
      subject: 'Verify your email',
      html: '<p>hello</p>',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[coke-email] EMAIL_USERNAME and EMAIL_PASSWORD must both be set for authenticated SMTP, or both omitted for unauthenticated SMTP.',
    );
    const transporterOptions = mocks.createTransportMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(transporterOptions).not.toHaveProperty('auth');
  });

  it('keeps implicit TLS enabled for port 465 when EMAIL_ENCRYPTION is unset', async () => {
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    process.env.EMAIL_PORT = '465';
    delete process.env.EMAIL_ENCRYPTION;

    await sendCokeEmail({
      to: 'alice@example.com',
      subject: 'Verify your email',
      html: '<p>hello</p>',
    });

    expect(mocks.createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        requireTls: false,
      }),
    );
  });
});
