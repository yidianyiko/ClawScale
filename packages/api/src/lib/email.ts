import nodemailer from 'nodemailer';

export interface SendCokeEmailInput {
  to: string;
  subject: string;
  html: string;
}

function getEmailFrom(): string {
  return process.env['EMAIL_FROM']?.trim() || 'noreply@coke.app';
}

function hasMailgunConfig(): boolean {
  return Boolean(process.env['MAILGUN_API_KEY']?.trim() && process.env['MAILGUN_DOMAIN']?.trim());
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

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`mailgun_send_failed:${response.status}`);
  }
}

async function sendViaSmtp(input: SendCokeEmailInput): Promise<void> {
  const host = process.env['EMAIL_HOST']?.trim();
  const port = Number(process.env['EMAIL_PORT']?.trim() || '587');
  if (!host) {
    throw new Error('smtp_config_missing');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env['EMAIL_USERNAME'] || process.env['EMAIL_PASSWORD']
      ? {
          user: process.env['EMAIL_USERNAME'],
          pass: process.env['EMAIL_PASSWORD'],
        }
      : undefined,
  });

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
    } catch {
      // Fall back to SMTP when Mailgun is configured but unavailable.
    }
  }

  await sendViaSmtp(input);
}
