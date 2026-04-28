import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

const openAiCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: openAiCreate,
      },
    },
  })),
}));

import { generateReply } from './ai-backend.js';

describe('custom backend metadata envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('preserves top-level gateway protocol fields inside ok envelope responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          reply: 'bridge ok',
          business_conversation_key: 'biz_conv_1',
          output_id: 'out_1',
          causal_inbound_event_id: 'in_evt_1',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateReply({
      backend: {
        type: 'custom',
        config: { baseUrl: 'https://bridge.local/reply', responseFormat: 'json-auto' } as any,
      },
      history: [{ role: 'user', content: '你好' }],
      sender: 'Alice',
      platform: 'wechat_personal',
      metadata: {},
    } as any);

    expect(result).toEqual({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
      causalInboundEventId: 'in_evt_1',
    });
  });
});

describe('OpenAI backend attachment conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAiCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    });
  });

  it('sends http image attachments as image_url parts', async () => {
    await generateReply({
      backend: {
        type: 'llm',
        config: { apiKey: 'test-key', model: 'gpt-test' } as any,
      },
      history: [
        {
          role: 'user',
          content: 'caption',
          attachments: [
            {
              url: 'https://cdn.example.com/photo.jpg',
              filename: 'photo.jpg',
              contentType: 'image/jpeg',
              safeDisplayUrl: 'https://cdn.example.com/photo.jpg',
            },
          ],
        },
      ],
    });

    const request = openAiCreate.mock.calls[0]?.[0];
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image_url', image_url: { url: 'https://cdn.example.com/photo.jpg' } },
        ],
      },
    ]);
  });

  it('redacts data image attachments into text parts instead of image_url parts', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;

    await generateReply({
      backend: {
        type: 'llm',
        config: { apiKey: 'test-key', model: 'gpt-test' } as any,
      },
      history: [
        {
          role: 'user',
          content: 'caption',
          attachments: [
            {
              url: dataUrl,
              filename: 'photo.png',
              contentType: 'image/png',
              safeDisplayUrl: '[inline image/png attachment: photo.png]',
            },
          ],
        },
      ],
    });

    const request = openAiCreate.mock.calls[0]?.[0];
    const parts = request.messages[0].content;
    expect(parts).toEqual([
      { type: 'text', text: 'caption' },
      { type: 'text', text: '[Attached image: [inline image/png attachment: photo.png]]' },
    ]);
    expect(parts).not.toContainEqual(
      expect.objectContaining({
        type: 'image_url',
        image_url: expect.objectContaining({ url: expect.stringContaining('data:') }),
      }),
    );
  });
});
