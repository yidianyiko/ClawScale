import { describe, expect, it } from 'vitest';

import {
  buildPublicWechatEcloudConfig,
  ensureStoredWechatEcloudConfig,
  hasWechatEcloudWebhookToken,
  parseStoredWechatEcloudConfig,
  parseWechatEcloudConfigInput,
} from './wechat-ecloud-config.js';

describe('wechat ecloud config helpers', () => {
  it('parses input config with default baseUrl and generated webhook token', () => {
    const stored = ensureStoredWechatEcloudConfig(
      parseWechatEcloudConfigInput({
        appId: 'app_1',
        token: 'token_1',
      }),
      () => 'generated_token',
    );

    expect(stored).toEqual({
      appId: 'app_1',
      token: 'token_1',
      baseUrl: 'https://api.geweapi.com',
      webhookToken: 'generated_token',
    });
  });

  it('scrubs token and webhookToken from public config', () => {
    expect(
      buildPublicWechatEcloudConfig({
        appId: 'app_1',
        token: 'token_1',
        baseUrl: 'https://api.example.test',
        webhookToken: 'secret',
      }),
    ).toEqual({
      appId: 'app_1',
      baseUrl: 'https://api.example.test',
      callbackPath: '/gateway/ecloud/wechat/:channelId/:token',
    });
  });

  it('requires stored webhook token for delivery routes', () => {
    expect(() =>
      parseStoredWechatEcloudConfig({
        appId: 'app_1',
        token: 'token_1',
      }),
    ).toThrow('invalid_wechat_ecloud_config:webhookToken');
  });

  it('detects whether a stored webhook token exists', () => {
    expect(hasWechatEcloudWebhookToken({ appId: 'app_1', token: 'token_1' })).toBe(false);
    expect(hasWechatEcloudWebhookToken({ appId: 'app_1', token: 'token_1', webhookToken: 'x' })).toBe(true);
  });
});
