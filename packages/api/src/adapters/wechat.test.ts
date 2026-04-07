import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  channelUpdate: vi.fn(),
  channelFindMany: vi.fn(),
  routeInboundMessage: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    channel: {
      update: mocks.channelUpdate,
      findMany: mocks.channelFindMany,
    },
  },
}));

vi.mock('../lib/route-message.js', () => ({
  routeInboundMessage: mocks.routeInboundMessage,
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: mocks.toDataURL,
  },
}));

import {
  getWeixinStatus,
  startWeixinQR,
  stopWeixinBot,
} from './wechat.js';

describe('wechat personal adapter', () => {
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,qr');
    mocks.channelUpdate.mockResolvedValue(undefined);
    mocks.channelFindMany.mockResolvedValue([]);
    mocks.routeInboundMessage.mockResolvedValue(null);
    console.error = vi.fn();
    console.log = vi.fn();
  });

  afterEach(async () => {
    await stopWeixinBot('ch_test');
    global.fetch = originalFetch;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    vi.useRealTimers();
  });

  it('keeps polling after a transient qr status timeout and connects on a later confirmation', async () => {
    let statusCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/ilink/bot/get_bot_qrcode')) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              qrcode: 'qr_123',
              qrcode_img_content: 'https://liteapp.weixin.qq.com/q/demo',
            }),
        } as Response;
      }

      if (url.includes('/ilink/bot/get_qrcode_status')) {
        statusCalls += 1;
        if (statusCalls === 1) {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }

        return {
          json: async () => ({
            status: 'confirmed',
            bot_token: 'bot-token',
            baseurl: 'https://ilink.example.com',
            ilink_bot_id: 'bot_123',
          }),
        } as Response;
      }

      if (url.includes('/ilink/bot/getupdates')) {
        return new Promise(() => {}) as Promise<Response>;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await startWeixinQR('ch_test');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.channelUpdate).toHaveBeenCalledWith({
      where: { id: 'ch_test' },
      data: {
        status: 'connected',
        config: { baseUrl: 'https://ilink.example.com', token: 'bot-token', botId: 'bot_123' },
      },
    });
    expect(getWeixinStatus('ch_test')).toBe('connected');
  });
});
