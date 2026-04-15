import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../components/locale-provider';

const pushMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const storeCokeUserAuthMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

vi.mock('../../../../lib/coke-user-api', () => ({
  cokeUserApi: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock('../../../../lib/coke-user-auth', () => ({
  storeCokeUserAuth: (...args: unknown[]) => storeCokeUserAuthMock(...args),
}));

import VerifyEmailPage from './page';

async function flushTicks(count: number) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('VerifyEmailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    postMock.mockReset();
    storeCokeUserAuthMock.mockReset();
    postMock.mockResolvedValue({
      ok: true,
      data: {
        token: 'auth-token',
        user: {
          id: 'acct_1',
          email: 'alice@example.com',
          display_name: 'Alice',
          email_verified: true,
          status: 'normal',
          subscription_active: true,
          subscription_expires_at: null,
        },
      },
    });
    window.history.pushState({}, '', '/coke/verify-email?token=verify-token&email=alice@example.com');

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('automatically verifies from the query string and redirects without manual entry UI', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(postMock).toHaveBeenCalledWith('/api/coke/verify-email', {
      token: 'verify-token',
      email: 'alice@example.com',
    });
    expect(container.querySelector('input#token')).toBeNull();
    expect(container.querySelector('input#email')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(replaceMock).toHaveBeenCalledWith('/coke/bind-wechat');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to renew when the verified account has no active subscription', async () => {
    postMock.mockResolvedValueOnce({
      ok: true,
      data: {
        token: 'auth-token',
        user: {
          id: 'acct_1',
          email: 'alice@example.com',
          display_name: 'Alice',
          email_verified: true,
          status: 'normal',
          subscription_active: false,
          subscription_expires_at: null,
        },
      },
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(storeCokeUserAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          subscription_active: false,
        }),
      }),
    );
    expect(replaceMock).toHaveBeenCalledWith('/coke/renew');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to login recovery when the verification link is missing token or email', async () => {
    window.history.pushState({}, '', '/coke/verify-email?email=alice@example.com');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(postMock).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith(
      '/coke/login?email=alice%40example.com&verification=expired',
    );
    expect(pushMock).not.toHaveBeenCalled();

    replaceMock.mockReset();
    postMock.mockReset();
    window.history.pushState({}, '', '/coke/verify-email?token=verify-token');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(postMock).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/coke/login?verification=expired');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to login recovery when the verification API returns not ok', async () => {
    postMock.mockResolvedValue({
      ok: false,
      error: 'invalid_or_expired_token',
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(replaceMock).toHaveBeenCalledWith(
      '/coke/login?email=alice%40example.com&verification=expired',
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to retry recovery when the verification request throws', async () => {
    postMock.mockRejectedValue(new Error('gateway unavailable'));

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(replaceMock).toHaveBeenCalledWith('/coke/login?email=alice%40example.com&verification=retry');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('renders the loading-focused verification copy without a manual form', async () => {
    postMock.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep the request pending so the loading copy remains visible.
        }),
    );

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(1);

    expect(container.textContent).toContain('验证邮箱');
    expect(container.textContent).toContain('正在验证你的邮箱链接');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
