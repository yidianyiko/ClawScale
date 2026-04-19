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

export async function deliverOutboundMessage(
  channel: { id: string; type: string; status?: string; config?: unknown },
  externalEndUserId: string,
  text: string,
): Promise<void> {
  assertConnectedChannel(channel);

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
      throw new Error(`Unsupported outbound channel type: ${channel.type}`);
  }
}
