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

  it('sanitizes provider failure messages without leaking the full raw value', async () => {
    const rawMessage = `sensitive provider failure ${'x'.repeat(300)}\nsecret-token-123`;
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ ret: 500, msg: rawMessage }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    let error: unknown;
    try {
      await new WechatEcloudApiClient('https://api.example.test', 'token_1', fetchImpl as never).sendText(
        'app_1',
        'wxid_1',
        'hello',
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/Ecloud API request failed.*sensitive provider failure/);
    expect(message).not.toContain(rawMessage);
    expect(message).not.toContain('secret-token-123');
    expect(message.length).toBeLessThan(240);
  });

  it('uses bounded sanitized HTTP error text without leaking the full raw body', async () => {
    const rawBody = `provider secret ${'x'.repeat(300)} <script>alert(1)</script>`;
    fetchImpl.mockResolvedValue(
      new Response(rawBody, {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    let error: unknown;
    try {
      await new WechatEcloudApiClient('https://api.example.test', 'token_1', fetchImpl as never).sendText(
        'app_1',
        'wxid_1',
        'hello',
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/Ecloud API request failed \(502\).*provider secret/);
    expect(message).not.toContain(rawBody);
    expect(message.length).toBeLessThan(260);
  });

  it('uses JSON message fields for HTTP errors when present', async () => {
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ msg: 'bad token', data: { secret: 'do not leak' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      new WechatEcloudApiClient('https://api.example.test', 'token_1', fetchImpl as never).sendText(
        'app_1',
        'wxid_1',
        'hello',
      ),
    ).rejects.toThrow('Ecloud API request failed (401) /gewe/v2/api/message/postText: bad token');
  });

  it('throws when success response body is invalid JSON', async () => {
    fetchImpl.mockResolvedValue(
      new Response('not-json', {
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
    ).rejects.toThrow('invalid_json');
  });
});
