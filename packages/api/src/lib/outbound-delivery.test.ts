import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendWeixinText = vi.hoisted(() => vi.fn());
const sendText = vi.hoisted(() => vi.fn());

vi.mock('../adapters/wechat.js', () => ({
  sendWeixinText,
}));
vi.mock('./evolution-api.js', () => ({
  EvolutionApiClient: vi.fn().mockImplementation(() => ({
    sendText,
  })),
}));

import { deliverOutboundMessage } from './outbound-delivery.js';

describe('deliverOutboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendWeixinText.mockResolvedValue(undefined as never);
    sendText.mockResolvedValue(undefined as never);
  });

  it('delivers personal wechat outbound messages', async () => {
    await deliverOutboundMessage(
      {
        id: 'ch_wechat_1',
        type: 'wechat_personal',
        status: 'connected',
      },
      'wxid_1',
      {
        text: 'hello',
        messageType: 'text',
        mediaUrls: [],
        audioAsVoice: false,
      },
    );

    expect(sendWeixinText).toHaveBeenCalledWith('ch_wechat_1', 'wxid_1', 'hello');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('delivers whatsapp_evolution messages through Evolution sendText', async () => {
    await deliverOutboundMessage(
      {
        id: 'ch_wa_1',
        type: 'whatsapp_evolution',
        status: 'connected',
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'secret-token',
        },
      },
      '8619917902815@s.whatsapp.net',
      {
        text: 'hello from coke',
        messageType: 'text',
        mediaUrls: [],
        audioAsVoice: false,
      },
    );

    expect(sendText).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      '8619917902815',
      'hello from coke',
    );
    expect(sendWeixinText).not.toHaveBeenCalled();
  });

  it('rejects outbound sends on disconnected channels', async () => {
    await expect(
      deliverOutboundMessage(
        {
          id: 'ch_wa_1',
          type: 'whatsapp_evolution',
          status: 'disconnected',
          config: {
            instanceName: 'coke-whatsapp-personal',
            webhookToken: 'secret-token',
          },
        },
        '8619917902815',
        {
          text: 'hello',
          messageType: 'text',
          mediaUrls: [],
          audioAsVoice: false,
        },
      ),
    ).rejects.toThrow('Outbound channel ch_wa_1 is not connected');

    expect(sendText).not.toHaveBeenCalled();
  });

  it('rejects malformed whatsapp targets', async () => {
    await expect(
      deliverOutboundMessage(
        {
          id: 'ch_wa_1',
          type: 'whatsapp_evolution',
          status: 'connected',
          config: {
            instanceName: 'coke-whatsapp-personal',
            webhookToken: 'secret-token',
          },
        },
        'not-a-number',
        {
          text: 'hello',
          messageType: 'text',
          mediaUrls: [],
          audioAsVoice: false,
        },
      ),
    ).rejects.toThrow('Invalid WhatsApp target: not-a-number');

    expect(sendText).not.toHaveBeenCalled();
  });

  it('rejects unsupported outbound channel types', async () => {
    await expect(
      deliverOutboundMessage(
        {
          id: 'ch_unknown_1',
          type: 'whatsapp_business',
          status: 'connected',
        },
        'target_1',
        {
          text: 'hello',
          messageType: 'text',
          mediaUrls: [],
          audioAsVoice: false,
        },
      ),
    ).rejects.toThrow('Unsupported outbound channel type: whatsapp_business');
  });

  it('delivers wechat media as visible attachment links', async () => {
    await deliverOutboundMessage(
      {
        id: 'ch_wechat_1',
        type: 'wechat_personal',
        status: 'connected',
      },
      'wxid_1',
      {
        text: 'caption',
        messageType: 'image',
        mediaUrls: ['https://cdn.example.com/photo.jpg'],
        audioAsVoice: false,
      },
    );

    expect(sendWeixinText).toHaveBeenCalledWith(
      'ch_wechat_1',
      'wxid_1',
      'caption\n\nAttachment: https://cdn.example.com/photo.jpg',
    );
    expect(sendText).not.toHaveBeenCalled();
  });

  it('delivers media-only fallback without a leading blank caption', async () => {
    await deliverOutboundMessage(
      {
        id: 'ch_wechat_1',
        type: 'wechat_personal',
        status: 'connected',
      },
      'wxid_1',
      {
        text: '',
        messageType: 'voice',
        mediaUrls: ['https://cdn.example.com/voice.mp3'],
        audioAsVoice: true,
      },
    );

    expect(sendWeixinText).toHaveBeenCalledWith(
      'ch_wechat_1',
      'wxid_1',
      'Attachment: https://cdn.example.com/voice.mp3',
    );
  });

  it('delivers whatsapp_evolution media as visible attachment links', async () => {
    await deliverOutboundMessage(
      {
        id: 'ch_wa_1',
        type: 'whatsapp_evolution',
        status: 'connected',
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'secret-token',
        },
      },
      '8619917902815@s.whatsapp.net',
      {
        text: 'caption',
        messageType: 'image',
        mediaUrls: ['https://cdn.example.com/photo.jpg'],
        audioAsVoice: false,
      },
    );

    expect(sendText).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      '8619917902815',
      'caption\n\nAttachment: https://cdn.example.com/photo.jpg',
    );
    expect(sendWeixinText).not.toHaveBeenCalled();
  });
});
