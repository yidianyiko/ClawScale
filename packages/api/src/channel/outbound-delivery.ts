import { sendWeixinText } from '../adapters/wechat.js';
import { EvolutionApiClient } from './evolution-api.js';
import { LinqApiClient } from './linq-api.js';
import { normalizeLinqPhoneNumber, parseStoredLinqConfig } from './linq-config.js';
import { parseStoredWhatsAppEvolutionConfig } from './whatsapp-evolution-config.js';
import { WechatEcloudApiClient } from './wechat-ecloud-api.js';
import { parseStoredWechatEcloudConfig } from './wechat-ecloud-config.js';

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

function normalizeOutboundPayload(payload: string | OutboundMessagePayload): OutboundMessagePayload {
  if (typeof payload === 'string') {
    return {
      text: payload,
      messageType: 'text',
      mediaUrls: [],
      audioAsVoice: false,
    };
  }

  return {
    ...payload,
    mediaUrls: payload.mediaUrls ?? [],
  };
}

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
  payload: string | OutboundMessagePayload,
): Promise<void> {
  assertConnectedChannel(channel);
  const normalizedPayload = normalizeOutboundPayload(payload);
  const text =
    normalizedPayload.mediaUrls.length > 0
      ? formatTextWithAttachmentLinks(normalizedPayload.text, normalizedPayload.mediaUrls)
      : normalizedPayload.text;

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
    case 'wechat_ecloud': {
      const config = parseStoredWechatEcloudConfig(channel.config);
      await new WechatEcloudApiClient(config.baseUrl, config.token).sendText(
        config.appId,
        externalEndUserId,
        text,
      );
      return;
    }
    case 'linq': {
      const config = parseStoredLinqConfig(channel.config);
      await new LinqApiClient().createChat({
        from: config.fromNumber,
        to: [normalizeLinqPhoneNumber(externalEndUserId)],
        text,
      });
      return;
    }
    default:
      if (normalizedPayload.mediaUrls.length > 0) {
        throw new Error(`Unsupported outbound media for channel type: ${channel.type}`);
      }
      throw new Error(`Unsupported outbound channel type: ${channel.type}`);
  }
}
