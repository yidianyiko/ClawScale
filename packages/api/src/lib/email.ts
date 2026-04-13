import nodemailer from 'nodemailer';

export interface SendCokeEmailInput {
  to: string;
  subject: string;
  html: string;
}

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function getEmailFromAddress(): string {
  return process.env['EMAIL_FROM']?.trim() || 'noreply@coke.app';
}

function getEmailFrom(): string {
  const fromAddress = getEmailFromAddress();
  const fromName = process.env['EMAIL_FROM_NAME']?.trim();
  return fromName ? '"' + fromName + '" <' + fromAddress + '>' : fromAddress;
}

function hasMailgunConfig(): boolean {
  return Boolean(process.env['MAILGUN_API_KEY']?.trim() && process.env['MAILGUN_DOMAIN']?.trim());
}

function hasSmtpConfig(): boolean {
  return Boolean(process.env['EMAIL_SERVICE']?.trim() || process.env['EMAIL_HOST']?.trim());
}

async function sendViaMailgun(input: SendCokeEmailInput): Promise<void> {
  const apiKey = process.env['MAILGUN_API_KEY']?.trim();
  const domain = process.env['MAILGUN_DOMAIN']?.trim();
  if (!apiKey || !domain) {
    throw new Error('mailgun_config_missing');
  }

  const body = new URLSearchParams({
    from: getEmailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
  });

  const auth = Buffer.from('api:' + apiKey).toString('base64');
  const response = await fetch('https://api.mailgun.net/v3/' + domain + '/messages', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
    },
    body,
  });

  if (!response.ok) {
    throw new Error('mailgun_send_failed:' + response.status);
  }
}

async function sendViaSmtp(input: SendCokeEmailInput): Promise<void> {
  const service = process.env['EMAIL_SERVICE']?.trim();
  const host = process.env['EMAIL_HOST']?.trim();
  const port = Number(process.env['EMAIL_PORT']?.trim() || '587');
  const encryption = process.env['EMAIL_ENCRYPTION']?.trim().toLowerCase();
  if (!service && !host) {
    throw new Error('smtp_config_missing');
  }

  const transporterOptions: Record<string, unknown> = {
    secure: encryption === 'tls' || (!encryption && port === 465),
    requireTls: encryption === 'starttls',
    tls: {
      rejectUnauthorized: !isEnabled(process.env['EMAIL_ALLOW_SELFSIGNED']),
    },
  };

  const encryptionHostname = process.env['EMAIL_ENCRYPTION_HOSTNAME']?.trim();
  if (encryptionHostname) {
    (transporterOptions['tls'] as { servername?: string }).servername = encryptionHostname;
  }

  if (service) {
    transporterOptions['service'] = service;
  } else {
    transporterOptions['host'] = host;
    transporterOptions['port'] = port;
  }

  const username = process.env['EMAIL_USERNAME']?.trim();
  const password = process.env['EMAIL_PASSWORD']?.trim();
  if (username && password) {
    transporterOptions['auth'] = {
      user: username,
      pass: password,
    };
  } else if (username || password) {
    console.warn(
      '[coke-email] EMAIL_USERNAME and EMAIL_PASSWORD must both be set for authenticated SMTP, or both omitted for unauthenticated SMTP.',
    );
  }

  const transporter = nodemailer.createTransport(transporterOptions);

  await transporter.sendMail({
    from: getEmailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}

export async function sendCokeEmail(input: SendCokeEmailInput): Promise<void> {
  if (hasMailgunConfig()) {
    try {
      await sendViaMailgun(input);
      return;
    } catch (error) {
      if (!hasSmtpConfig()) {
        throw error;
      }
      // Fall back to SMTP when Mailgun is configured but unavailable.
    }
  }

  await sendViaSmtp(input);
}
