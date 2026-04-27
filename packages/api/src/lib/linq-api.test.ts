import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

import { LINQ_WEBHOOK_EVENTS, LINQ_WEBHOOK_VERSION, LinqApiClient } from './linq-api.js';

describe('LinqApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('creates a chat with text message parts', async () => {
    const client = new LinqApiClient('https://linq.example/api/', 'test-api-key', fetchMock);

    await client.createChat({
      from: '+13213108456',
      to: ['+8615201780593'],
      text: 'hello',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://linq.example/api/chats',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
          Accept: 'application/json',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          from: '+13213108456',
          to: ['+8615201780593'],
          message: {
            parts: [{ type: 'text', value: 'hello' }],
          },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('creates a webhook subscription pinned to the Linq webhook payload version', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'sub_1', signing_secret: 'secret_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new LinqApiClient('https://linq.example/api', 'test-api-key', fetchMock);

    const result = await client.createWebhookSubscription({
      targetUrl: 'https://gateway.example/gateway/linq/ch_1/token_1?existing=1',
      phoneNumbers: ['+13213108456'],
    });

    expect(result).toEqual({ id: 'sub_1', signingSecret: 'secret_1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://linq.example/api/webhook-subscriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
          Accept: 'application/json',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          target_url: 'https://gateway.example/gateway/linq/ch_1/token_1?existing=1&version=2026-02-03',
          subscribed_events: ['message.received'],
          phone_numbers: ['+13213108456'],
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(LINQ_WEBHOOK_VERSION).toBe('2026-02-03');
    expect(LINQ_WEBHOOK_EVENTS).toEqual(['message.received']);
  });

  it('deletes a webhook subscription', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new LinqApiClient('https://linq.example/api', 'test-api-key', fetchMock);

    await client.deleteWebhookSubscription('sub_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://linq.example/api/webhook-subscriptions/sub_1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
          Accept: 'application/json',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('wraps network failures with the request path', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const client = new LinqApiClient('https://linq.example/api', 'test-api-key', fetchMock);

    await expect(
      client.createChat({
        from: '+13213108456',
        to: ['+8615201780593'],
        text: 'hello',
      }),
    ).rejects.toThrow('Linq API request failed /chats: socket hang up');
  });
});
