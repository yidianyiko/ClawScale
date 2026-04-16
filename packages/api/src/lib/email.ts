import { Resend } from 'resend';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export type SendCokeEmailInput = SendEmailInput;

function getResendApiKey(): string {
  const apiKey = process.env['RESEND_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error('resend_config_missing');
  }
  return apiKey;
}

function getEmailFromAddress(): string {
  return process.env['EMAIL_FROM']?.trim() || 'noreply@keep4oforever.com';
}

function getEmailFrom(): string {
  const fromAddress = getEmailFromAddress();
  const fromName = process.env['EMAIL_FROM_NAME']?.trim();
  return fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const resend = new Resend(getResendApiKey());
  const { data, error } = await resend.emails.send({
    from: getEmailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
  });

  if (error) {
    throw new Error('resend_send_failed:' + error.message);
  }

  if (!data?.id) {
    throw new Error('resend_send_failed:missing_id');
  }
}

export const sendCokeEmail = sendEmail;
