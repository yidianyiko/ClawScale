import { sendWeixinText } from '../adapters/wechat.js';
import { EvolutionApiClient } from './evolution-api.js';
import { parseStoredWhatsAppEvolutionConfig } from './whatsapp-evolution-config.js';

function assertConnectedChannel(channel: { id: string; status?: string }) {
  if (channel.status && channel.status !== 'connected') {
    throw new Error(`Outbound channel ${channel.id} is not connected`);
  }
}

function normalizeWhatsAppTarget(value: string): string {
  const digits = value.replace(/\D+/g, '');
  if (!digits) {
    throw new Error(`Invalid WhatsApp target: ${value}`);
  }

  return digits;
}

export type OutboundMessagePayload = {
  text: string;
  messageType: 'text' | 'image' | 'voice';
  mediaUrls: string[];
  audioAsVoice: boolean;
};

function formatTextWithAttachmentLinks(text: string, mediaUrls: string[]): string {
  const trimmedText = text.trim();
  const attachmentText = mediaUrls.map((url) => `Attachment: ${url}`).join('\n');
  if (!trimmedText) return attachmentText;
  if (!attachmentText) return trimmedText;
  return `${trimmedText}\n\n${attachmentText}`;
}

export async function deliverOutboundMessage(
  channel: { id: string; type: string; status?: string; config?: unknown },
  externalEndUserId: string,
  payload: OutboundMessagePayload,
): Promise<void> {
  assertConnectedChannel(channel);
  const text =
    payload.mediaUrls.length > 0
      ? formatTextWithAttachmentLinks(payload.text, payload.mediaUrls)
      : payload.text;

  switch (channel.type) {
    case 'wechat_personal':
      await sendWeixinText(channel.id, externalEndUserId, text);
      return;
    case 'whatsapp_evolution': {
      const config = parseStoredWhatsAppEvolutionConfig(channel.config);
      await new EvolutionApiClient().sendText(
        config.instanceName,
        normalizeWhatsAppTarget(externalEndUserId),
        text,
      );
      return;
    }
    default:
      if (payload.mediaUrls.length > 0) {
        throw new Error(`Unsupported outbound media for channel type: ${channel.type}`);
      }
      throw new Error(`Unsupported outbound channel type: ${channel.type}`);
  }
}
