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
  initWeixinAdapters,
  getWeixinStatus,
  getWeixinRestoreState,
  startWeixinQR,
  stopWeixinBot,
} from './wechat.js';

describe('wechat personal adapter', () => {
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalWeixinBaseUrl = process.env.WEIXIN_PERSONAL_BASE_URL;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.WEIXIN_PERSONAL_BASE_URL;
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
    if (originalWeixinBaseUrl === undefined) {
      delete process.env.WEIXIN_PERSONAL_BASE_URL;
    } else {
      process.env.WEIXIN_PERSONAL_BASE_URL = originalWeixinBaseUrl;
    }
    vi.useRealTimers();
  });

  it('uses WEIXIN_PERSONAL_BASE_URL during qr bootstrap', async () => {
    process.env.WEIXIN_PERSONAL_BASE_URL = 'http://127.0.0.1:19090';

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('http://127.0.0.1:19090/ilink/bot/get_bot_qrcode')) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              qrcode: 'qr_123',
              qrcode_img_content: 'https://liteapp.weixin.qq.com/q/demo',
            }),
        } as Response;
      }

      if (url.includes('http://127.0.0.1:19090/ilink/bot/get_qrcode_status')) {
        return {
          json: async () => ({
            status: 'confirmed',
            bot_token: 'bot-token',
            ilink_bot_id: 'bot_123',
          }),
        } as Response;
      }

      if (url.includes('http://127.0.0.1:19090/ilink/bot/getupdates')) {
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
        config: { baseUrl: 'http://127.0.0.1:19090', token: 'bot-token', botId: 'bot_123' },
      },
    });
    expect(getWeixinStatus('ch_test')).toBe('connected');
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

  it('marks an expired qr login as error on the channel row', async () => {
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
        return {
          json: async () => ({
            status: 'expired',
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

    expect(mocks.channelUpdate).toHaveBeenCalledWith({
      where: { id: 'ch_test' },
      data: {
        status: 'error',
        config: {},
      },
    });
    expect(getWeixinStatus('ch_test')).toBe('error');
  });

  it('marks an initial qr bootstrap parse failure as error on the channel row', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/ilink/bot/get_bot_qrcode')) {
        return {
          status: 200,
          text: async () => 'not-json',
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await startWeixinQR('ch_test');
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.channelUpdate).toHaveBeenCalledWith({
      where: { id: 'ch_test' },
      data: {
        status: 'error',
        config: {},
      },
    });
    expect(getWeixinStatus('ch_test')).toBe('error');
  });

  it('does not start a second qr login flow for the same channel while one is already pending', async () => {
    let qrFetches = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/ilink/bot/get_bot_qrcode')) {
        qrFetches += 1;
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
    await startWeixinQR('ch_test');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(qrFetches).toBe(1);
    expect(mocks.channelUpdate).toHaveBeenCalledWith({
      where: { id: 'ch_test' },
      data: {
        status: 'connected',
        config: { baseUrl: 'https://ilink.example.com', token: 'bot-token', botId: 'bot_123' },
      },
    });
    expect(getWeixinStatus('ch_test')).toBe('connected');
  });

  it('does not persist bootstrap failure state after the flow has been cancelled', async () => {
    let releaseText!: () => void;
    const textReady = new Promise<void>((resolve) => {
      releaseText = resolve;
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/ilink/bot/get_bot_qrcode')) {
        return {
          status: 200,
          text: async () => {
            await textReady;
            return 'not-json';
          },
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await startWeixinQR('ch_test');
    await Promise.resolve();
    await stopWeixinBot('ch_test');
    releaseText();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.channelUpdate).not.toHaveBeenCalled();
    expect(getWeixinStatus('ch_test')).toBeNull();
  });

  it('does not reconnect after a confirmed bootstrap when the flow is cancelled before handoff completes', async () => {
    let releaseUpdate!: () => void;
    const updateReady = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });

    mocks.channelUpdate.mockImplementationOnce(async () => {
      await updateReady;
      return undefined;
    });

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
    await stopWeixinBot('ch_test');
    releaseUpdate();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.channelUpdate).toHaveBeenCalledTimes(1);
    expect(getWeixinStatus('ch_test')).toBeNull();
  });

  it('marks restore state ready after a successful init pass', async () => {
    mocks.channelFindMany.mockResolvedValueOnce([]);

    await expect(initWeixinAdapters()).resolves.toBeUndefined();
    expect(getWeixinRestoreState()).toBe('ready');
  });

  it('keeps readiness false when initWeixinAdapters fails during restore', async () => {
    mocks.channelFindMany.mockRejectedValueOnce(new Error('restore failed'));

    await expect(initWeixinAdapters()).rejects.toThrow('restore failed');
    expect(getWeixinRestoreState()).toBe('failed');
  });
});
