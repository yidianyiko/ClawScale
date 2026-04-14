import { describe, expect, it } from 'vitest';

import {
  getLocalizedAiBackendCopy,
  getLocalizedChannelCopy,
} from '../../lib/dashboard-schema-copy';

describe('dashboard schema localization helper', () => {
  it('returns English channel schema copy for dashboard channels', () => {
    const copy = getLocalizedChannelCopy('en');

    expect(copy.pageTitle).toBe('Channels');
    expect(copy.addModalTitle).toBe('Add a channel');
    expect(copy.status.connected).toBe('Connected');
    expect(copy.schema.whatsapp_business.label).toBe('WhatsApp Business API');
    expect(copy.schema.whatsapp_business.fields[0]).toMatchObject({
      key: 'phoneNumberId',
      label: 'Phone Number ID',
      placeholder: '123456789012345 (not the phone number itself)',
    });
    expect(copy.qrInstructions.wechat_personal).toBe(
      'Open WeChat -> Me -> WeChat ID -> scan the code',
    );
  });

  it('returns Chinese backend descriptor copy for dashboard ai-backends', () => {
    const copy = getLocalizedAiBackendCopy('zh');

    expect(copy.pageTitle).toBe('AI 后端');
    expect(copy.addBackendButton).toBe('添加后端');
    expect(copy.providerLabels.custom).toBe('自定义后端');
    expect(copy.descriptors.custom.fields.find((field) => field.key === 'transport')).toMatchObject({
      label: '传输方式',
      selectOptions: [
        { label: 'HTTP', value: 'http' },
        { label: 'SSE', value: 'sse' },
        { label: 'WebSocket', value: 'websocket' },
      ],
    });
    expect(copy.descriptors.llm.fields.find((field) => field.key === 'baseUrl')).toMatchObject({
      label: '基础 URL',
      hint: '使用 OpenAI 时留空，兼容提供商可填写',
    });
    expect(copy.clawscale.editTitle).toBe('编辑 ClawScale 编排器');
  });
});
