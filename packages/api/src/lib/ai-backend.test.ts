import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateReply } from './ai-backend.js';

describe('custom backend metadata envelope', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes tenant and end-user metadata in fetch body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reply: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await generateReply({
      backend: {
        type: 'custom',
        config: { baseUrl: 'https://bridge.local/reply', responseFormat: 'json-auto' } as any,
      },
      history: [{ role: 'user', content: '你好' }],
      sender: 'Alice',
      platform: 'wechat_personal',
      metadata: {
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        conversationId: 'conv_1',
        externalId: 'wxid_123',
      },
    } as any);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit?.body).toBeDefined();

    const body = JSON.parse(String(requestInit?.body));
    expect(body.metadata.tenantId).toBe('ten_1');
    expect(body.metadata.channelId).toBe('ch_1');
    expect(body.metadata.endUserId).toBe('eu_1');
  });
});
