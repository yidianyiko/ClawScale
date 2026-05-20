import { describe, expect, it } from 'vitest';
import { CHANNEL_CONFIG_SCHEMA } from './provider-config-schema.js';

describe('provider config schema boundary', () => {
  it('keeps provider config schema in the backend-only channel module', () => {
    expect(CHANNEL_CONFIG_SCHEMA.whatsapp_business.fields.map((field) => field.key)).toEqual([
      'phoneNumberId',
      'accessToken',
      'verifyToken',
    ]);
    expect(CHANNEL_CONFIG_SCHEMA.wechat_ecloud.fields.map((field) => field.key)).toEqual([
      'appId',
      'token',
      'baseUrl',
    ]);
    expect(CHANNEL_CONFIG_SCHEMA.linq.fields.map((field) => field.key)).toEqual([
      'fromNumber',
    ]);
  });
});
