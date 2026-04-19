import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

import { EvolutionApiClient } from './evolution-api.js';

describe('EvolutionApiClient', () => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env['EVOLUTION_API_BASE_URL'];
  const originalApiKey = process.env['EVOLUTION_API_KEY'];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env['EVOLUTION_API_BASE_URL'] = 'https://evolution.example';
    process.env['EVOLUTION_API_KEY'] = 'test-api-key';

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env['EVOLUTION_API_BASE_URL'];
    } else {
      process.env['EVOLUTION_API_BASE_URL'] = originalBaseUrl;
    }

    if (originalApiKey === undefined) {
      delete process.env['EVOLUTION_API_KEY'];
    } else {
      process.env['EVOLUTION_API_KEY'] = originalApiKey;
    }
  });

  it('sets instance webhook with MESSAGES_UPSERT only', async () => {
    const client = new EvolutionApiClient();

    await client.setWebhook('coke-whatsapp-personal', 'https://coke.example/gateway/evolution/whatsapp/ch_1/token_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example/webhook/set/coke-whatsapp-personal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'test-api-key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          enabled: true,
          url: 'https://coke.example/gateway/evolution/whatsapp/ch_1/token_1',
          events: ['MESSAGES_UPSERT'],
          webhookByEvents: false,
          webhookBase64: false,
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('clears instance webhook by disabling deliveries', async () => {
    const client = new EvolutionApiClient();

    await client.clearWebhook('coke-whatsapp-personal');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example/webhook/set/coke-whatsapp-personal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          enabled: false,
          url: 'https://invalid.local/disabled',
          events: ['MESSAGES_UPSERT'],
          webhookByEvents: false,
          webhookBase64: false,
        }),
      }),
    );
  });

  it('sends plain text through /message/sendText/{instance}', async () => {
    const client = new EvolutionApiClient();

    await client.sendText('coke-whatsapp-personal', '8619917902815', 'hello');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example/message/sendText/coke-whatsapp-personal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'test-api-key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          number: '8619917902815',
          text: 'hello',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('wraps network failures with the request path', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    const client = new EvolutionApiClient();

    await expect(client.sendText('coke-whatsapp-personal', '8619917902815', 'hello')).rejects.toThrow(
      'Evolution API request failed /message/sendText/coke-whatsapp-personal: socket hang up',
    );
  });
});
