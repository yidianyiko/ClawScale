import { sendWeixinText } from '../adapters/wechat.js';


export async function deliverOutboundMessage(
  channel: { id: string; type: string },
  externalEndUserId: string,
  text: string,
): Promise<void> {
  switch (channel.type) {
    case 'wechat_personal':
      await sendWeixinText(channel.id, externalEndUserId, text);
      return;
    default:
      throw new Error(`Unsupported outbound channel type: ${channel.type}`);
  }
}
