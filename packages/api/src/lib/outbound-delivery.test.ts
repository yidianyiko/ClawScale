import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendWeixinText = vi.hoisted(() => vi.fn());
const sendText = vi.hoisted(() => vi.fn());
const sendWechatEcloudText = vi.hoisted(() => vi.fn());

vi.mock('../adapters/wechat.js', () => ({
  sendWeixinText,
}));
vi.mock('./evolution-api.js', () => ({
  EvolutionApiClient: vi.fn().mockImplementation(() => ({
    sendText,
  })),
}));
vi.mock('./wechat-ecloud-api.js', () => ({
  WechatEcloudApiClient: vi.fn().mockImplementation(() => ({
    sendText: sendWechatEcloudText,
  })),
}));

import { deliverOutboundMessage } from './outbound-delivery.js';
import { WechatEcloudApiClient } from './wechat-ecloud-api.js';

describe('deliverOutboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendWeixinText.mockResolvedValue(undefined as never);
    sendText.mockResolvedValue(undefined as never);
    sendWechatEcloudText.mockResolvedValue(undefined as never);
  });

  it('delivers personal wechat outbound messages', async () => {
    await deliverOutboundMessage(
      {
        id: 'ch_wechat_1',
        type: 'wechat_personal',
        status: 'connected',
      },
      'wxid_1',
      'hello',
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
      'hello from coke',
    );

    expect(sendText).toHaveBeenCalledWith(
      'coke-whatsapp-personal',
      '8619917902815',
      'hello from coke',
    );
    expect(sendWeixinText).not.toHaveBeenCalled();
  });

  it('delivers wechat_ecloud messages through Ecloud sendText', async () => {
    await deliverOutboundMessage(
      {
        id: 'ch_ecloud_1',
        type: 'wechat_ecloud',
        status: 'connected',
        config: {
          appId: 'app_1',
          token: 'token_1',
          baseUrl: 'https://api.example.test',
          webhookToken: 'webhook_token_1',
        },
      },
      'wxid_target',
      'hello from coke',
    );

    expect(WechatEcloudApiClient).toHaveBeenCalledWith('https://api.example.test', 'token_1');
    expect(sendWechatEcloudText).toHaveBeenCalledWith(
      'app_1',
      'wxid_target',
      'hello from coke',
    );
    expect(sendWeixinText).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
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
        'hello',
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
        'hello',
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
        'hello',
      ),
    ).rejects.toThrow('Unsupported outbound channel type: whatsapp_business');
  });
});
