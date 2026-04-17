import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../../components/locale-provider';

const redirectMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const getCokeUserTokenMock = vi.hoisted(() => vi.fn());
const getCokeUserMock = vi.hoisted(() => vi.fn());
const clearCokeUserAuthMock = vi.hoisted(() => vi.fn());
const getCokeUserWechatChannelStatusMock = vi.hoisted(() => vi.fn());
const connectCokeUserWechatChannelMock = vi.hoisted(() => vi.fn());
const archiveCokeUserWechatChannelMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(
      async (value: string) => `data:image/png;base64,${Buffer.from(value).toString('base64')}`,
    ),
  },
}));

vi.mock('../../../../lib/coke-user-auth', () => ({
  getCokeUserToken: () => getCokeUserTokenMock(),
  getCokeUser: () => getCokeUserMock(),
  clearCokeUserAuth: () => clearCokeUserAuthMock(),
  isCokeUserSuspended: (user: { status?: string } | null) => user?.status === 'suspended',
  needsCokeEmailVerification: (user: { email_verified?: boolean } | null) => user?.email_verified !== true,
  needsCokeSubscriptionRenewal: (user: { subscription_active?: boolean } | null) => user?.subscription_active !== true,
}));

vi.mock('../../../../lib/coke-user-wechat-channel', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/coke-user-wechat-channel')>(
    '../../../../lib/coke-user-wechat-channel',
  );

  return {
    ...actual,
    archiveCokeUserWechatChannel: () => archiveCokeUserWechatChannelMock(),
    connectCokeUserWechatChannel: () => connectCokeUserWechatChannelMock(),
    getCokeUserWechatChannelStatus: () => getCokeUserWechatChannelStatusMock(),
  };
});

import CustomerWechatPersonalPage from '../../../(customer)/channels/wechat-personal/page';
import LegacyBindWechatPage from './page';

async function flushTicks(count: number) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForText(container: HTMLElement, text: string) {
  for (let i = 0; i < 20; i += 1) {
    if (container.textContent?.includes(text)) {
      return;
    }

    await flushTicks(1);
  }

  throw new Error(`Timed out waiting for "${text}"`);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function renderWithLocale(root: Root, locale: 'en' | 'zh') {
  flushSync(() => {
    root.render(
      <LocaleProvider initialLocale={locale}>
        <CustomerWechatPersonalPage />
      </LocaleProvider>,
    );
  });
}

describe('LegacyBindWechatPage redirect', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects the legacy bind route to the neutral customer channels page', async () => {
    await LegacyBindWechatPage({});

    expect(redirectMock).toHaveBeenCalledWith('/channels/wechat-personal');
  });

  it('preserves legacy bind query params when redirecting to the neutral route', async () => {
    await LegacyBindWechatPage({
      searchParams: Promise.resolve({
        next: 'renew',
        source: 'legacy',
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/channels/wechat-personal?next=renew&source=legacy');
  });
});

describe('BindWechatPage initial load failure', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    getCokeUserTokenMock.mockReset();
    getCokeUserMock.mockReset();
    clearCokeUserAuthMock.mockReset();
    getCokeUserWechatChannelStatusMock.mockReset();

    getCokeUserTokenMock.mockReturnValue('token');
    getCokeUserMock.mockReturnValue({
      display_name: 'Alice',
      email_verified: true,
      status: 'normal',
      subscription_active: true,
      subscription_expires_at: '2026-05-01T00:00:00.000Z',
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('shows a plain retry state when the initial status load fails', async () => {
    getCokeUserWechatChannelStatusMock.mockResolvedValueOnce({
      ok: false,
      error: 'Temporary bridge failure',
    });

    renderWithLocale(root, 'en');
    await flushTicks(5);

    expect(container.textContent).toContain('Unable to load your WeChat channel');
    expect(container.textContent).toContain('Retry');
    expect(container.textContent).not.toContain('Reconnect');
    expect(container.textContent).not.toContain('Archive channel');
  });
});

describe('BindWechatPage blocked access states', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    getCokeUserTokenMock.mockReset();
    getCokeUserMock.mockReset();
    clearCokeUserAuthMock.mockReset();
    getCokeUserWechatChannelStatusMock.mockReset();

    getCokeUserTokenMock.mockReturnValue('token');
    getCokeUserMock.mockReturnValue({
      display_name: 'Alice',
      email_verified: false,
      status: 'normal',
      subscription_active: false,
      subscription_expires_at: null,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('shows the blocked access prompt and does not load channel state', async () => {
    renderWithLocale(root, 'zh');
    await flushTicks(2);

    expect(getCokeUserWechatChannelStatusMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('先完成邮箱验证和订阅续费');
    expect(container.querySelector('a[href="/coke/verify-email"]')).toBeTruthy();
    expect(container.querySelector('a[href="/coke/renew"]')).toBeTruthy();
    expect(container.textContent).not.toContain('Verify your email and renew your subscription');
  });
});

describe('BindWechatPage archive action', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    getCokeUserTokenMock.mockReset();
    getCokeUserMock.mockReset();
    clearCokeUserAuthMock.mockReset();
    getCokeUserWechatChannelStatusMock.mockReset();
    connectCokeUserWechatChannelMock.mockReset();
    archiveCokeUserWechatChannelMock.mockReset();

    getCokeUserTokenMock.mockReturnValue('token');
    getCokeUserMock.mockReturnValue({
      display_name: 'Alice',
      email_verified: true,
      status: 'normal',
      subscription_active: true,
      subscription_expires_at: '2026-05-01T00:00:00.000Z',
    });
    archiveCokeUserWechatChannelMock.mockResolvedValue({
      ok: true,
      data: { status: 'archived' },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('lands in the archived state when archive succeeds with an empty response body', async () => {
    getCokeUserWechatChannelStatusMock.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'error',
        error: 'Temporary bridge failure',
      },
    });

    renderWithLocale(root, 'en');
    await flushTicks(5);

    const archiveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Archive channel'),
    );

    expect(archiveButton).toBeTruthy();
    archiveButton?.click();
    await waitForText(container, 'This WeChat channel is archived');

    expect(archiveCokeUserWechatChannelMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('This WeChat channel is archived');
    expect(container.textContent).toContain('Create my WeChat channel again');
    expect(container.textContent).not.toContain('Reconnect or archive your channel');
  });
});

describe('BindWechatPage concurrent mutation guard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    getCokeUserTokenMock.mockReset();
    getCokeUserMock.mockReset();
    clearCokeUserAuthMock.mockReset();
    getCokeUserWechatChannelStatusMock.mockReset();
    connectCokeUserWechatChannelMock.mockReset();
    archiveCokeUserWechatChannelMock.mockReset();

    getCokeUserTokenMock.mockReturnValue('token');
    getCokeUserMock.mockReturnValue({
      display_name: 'Alice',
      email_verified: true,
      status: 'normal',
      subscription_active: true,
      subscription_expires_at: '2026-05-01T00:00:00.000Z',
    });
    connectCokeUserWechatChannelMock.mockReturnValue(new Promise(() => {}));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('prevents archive from firing while reconnect is in flight', async () => {
    getCokeUserWechatChannelStatusMock.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'error',
        error: 'Temporary bridge failure',
      },
    });

    renderWithLocale(root, 'en');
    await flushTicks(5);

    const reconnectButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Reconnect'),
    );
    const archiveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Archive channel'),
    );

    expect(reconnectButton).toBeTruthy();
    expect(archiveButton).toBeTruthy();

    reconnectButton?.click();
    archiveButton?.click();

    expect(connectCokeUserWechatChannelMock).toHaveBeenCalledTimes(1);
    expect(archiveCokeUserWechatChannelMock).not.toHaveBeenCalled();
  });
});

describe('BindWechatPage suspended account state', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    getCokeUserTokenMock.mockReset();
    getCokeUserMock.mockReset();
    clearCokeUserAuthMock.mockReset();
    getCokeUserWechatChannelStatusMock.mockReset();

    getCokeUserTokenMock.mockReturnValue('token');
    getCokeUserMock.mockReturnValue({
      display_name: 'Alice',
      email_verified: true,
      status: 'suspended',
      subscription_active: true,
      subscription_expires_at: '2026-05-01T00:00:00.000Z',
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('shows a suspended account message without loading channel state', async () => {
    renderWithLocale(root, 'en');
    await flushTicks(2);

    expect(getCokeUserWechatChannelStatusMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Your Coke account is suspended');
    expect(container.textContent).not.toContain('Create my WeChat channel');
  });
});

describe('BindWechatPage refresh ordering', () => {
  let container: HTMLDivElement;
  let root: Root;
  let intervalCallbacks: Array<() => void>;

  beforeEach(() => {
    replaceMock.mockReset();
    getCokeUserTokenMock.mockReset();
    getCokeUserMock.mockReset();
    clearCokeUserAuthMock.mockReset();
    getCokeUserWechatChannelStatusMock.mockReset();
    connectCokeUserWechatChannelMock.mockReset();
    archiveCokeUserWechatChannelMock.mockReset();
    intervalCallbacks = [];

    vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler) => {
      intervalCallbacks.push(() => {
        if (typeof handler === 'function') {
          handler();
        }
      });
      return 1 as unknown as number;
    }) as typeof window.setInterval);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);

    getCokeUserTokenMock.mockReturnValue('token');
    getCokeUserMock.mockReturnValue({
      display_name: 'Alice',
      email_verified: true,
      status: 'normal',
      subscription_active: true,
      subscription_expires_at: '2026-05-01T00:00:00.000Z',
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('keeps fresher mutation QR data when an older poll resolves later', async () => {
    const staleRefresh = createDeferred<{
      ok: true;
      data: {
        status: 'pending';
        connect_url: string;
        expires_at: number;
      };
    }>();

    getCokeUserWechatChannelStatusMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 'pending',
          connect_url: 'https://wx.example.com/connect/initial',
          expires_at: 1710000000,
        },
      })
      .mockReturnValueOnce(staleRefresh.promise);

    connectCokeUserWechatChannelMock.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'pending',
        connect_url: 'https://wx.example.com/connect/fresh',
        expires_at: 1710003600,
      },
    });

    renderWithLocale(root, 'en');

    const freshExpiryText = new Date(1710003600 * 1000).toLocaleString();
    const staleExpiryText = new Date(1709990000 * 1000).toLocaleString();

    await flushTicks(5);
    expect(intervalCallbacks).toHaveLength(1);
    intervalCallbacks[0]();

    const refreshButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Refresh QR'),
    );
    expect(refreshButton).toBeTruthy();
    refreshButton?.click();

    await waitForText(container, freshExpiryText);
    staleRefresh.resolve({
      ok: true,
      data: {
        status: 'pending',
        connect_url: 'https://wx.example.com/connect/stale',
        expires_at: 1709990000,
      },
    });

    await flushTicks(5);

    expect(container.textContent).toContain(freshExpiryText);
    expect(container.textContent).not.toContain(staleExpiryText);
  });
});
