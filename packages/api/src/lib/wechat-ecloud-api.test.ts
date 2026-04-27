import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WechatEcloudApiClient } from './wechat-ecloud-api.js';

describe('WechatEcloudApiClient', () => {
  const fetchImpl = vi.fn();

  beforeEach(() => {
    fetchImpl.mockReset();
  });

  it('posts text with X-GEWE-TOKEN and treats ret=200 as success', async () => {
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ ret: 200, msg: 'success', data: { msgId: 'm1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await new WechatEcloudApiClient('https://api.example.test/', 'token_1', fetchImpl as never).sendText(
      'app_1',
      'wxid_1',
      'hello',
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/gewe/v2/api/message/postText',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-GEWE-TOKEN': 'token_1',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ appId: 'app_1', toWxid: 'wxid_1', content: 'hello' }),
      }),
    );
  });

  it('throws on application-level failure even with HTTP 200', async () => {
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ ret: 500, msg: 'bad token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      new WechatEcloudApiClient('https://api.example.test', 'token_1', fetchImpl as never).sendText(
        'app_1',
        'wxid_1',
        'hello',
      ),
    ).rejects.toThrow('Ecloud API request failed');
  });
});
