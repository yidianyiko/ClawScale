import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../components/locale-provider';

const pushMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const storeCokeUserAuthMock = vi.hoisted(() => vi.fn());
const getCokeUserMock = vi.hoisted(() => vi.fn());

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
  getCokeUser: () => getCokeUserMock(),
}));

import CustomerVerifyEmailPage from './page';

async function flushTicks(count: number) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('CustomerVerifyEmailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    postMock.mockReset();
    storeCokeUserAuthMock.mockReset();
    getCokeUserMock.mockReset();
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
    getCokeUserMock.mockReturnValue({
      id: 'acct_1',
      email: 'alice@example.com',
      display_name: 'Alice',
      email_verified: false,
      status: 'normal',
      subscription_active: false,
      subscription_expires_at: null,
    });
    window.history.pushState({}, '', '/auth/verify-email?token=verify-token&email=alice@example.com');

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
          <CustomerVerifyEmailPage />
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
    expect(replaceMock).toHaveBeenCalledWith('/channels/wechat-personal');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('routes renewal-required verification success through the neutral channel path', async () => {
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
          <CustomerVerifyEmailPage />
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
    expect(replaceMock).toHaveBeenCalledWith('/channels/wechat-personal?next=renew');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('uses the stored auth email to keep the registration handoff on a working recovery flow', async () => {
    window.history.pushState({}, '', '/auth/verify-email');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerVerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(postMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Verify your email');
    expect(container.textContent).toContain('Resend verification email');

    const emailInput = container.querySelector('input#email') as HTMLInputElement | null;
    expect(emailInput?.value).toBe('alice@example.com');

    const resendButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Resend verification email'),
    );
    expect(resendButton).toBeTruthy();

    resendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushTicks(2);

    expect(postMock).toHaveBeenCalledWith('/api/coke/verify-email/resend', {
      email: 'alice@example.com',
    });
    expect(container.textContent).toContain('Verification email sent. Check your inbox.');
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('supports manual resend recovery when opened without query params and no stored auth email', async () => {
    getCokeUserMock.mockReturnValue(null);
    window.history.pushState({}, '', '/auth/verify-email');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerVerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(postMock).not.toHaveBeenCalled();

    const emailInput = container.querySelector('input#email') as HTMLInputElement | null;
    expect(emailInput?.value).toBe('');

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(emailInput, 'manual@example.com');
    emailInput?.dispatchEvent(new Event('input', { bubbles: true }));

    const resendButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Resend verification email'),
    );
    expect(resendButton).toBeTruthy();

    resendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushTicks(2);

    expect(postMock).toHaveBeenCalledWith('/api/coke/verify-email/resend', {
      email: 'manual@example.com',
    });
    expect(container.textContent).toContain('Verification email sent. Check your inbox.');
    expect(replaceMock).not.toHaveBeenCalled();
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
          <CustomerVerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(replaceMock).toHaveBeenCalledWith(
      '/auth/login?email=alice%40example.com&verification=expired',
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to retry recovery when the verification request throws', async () => {
    postMock.mockRejectedValue(new Error('gateway unavailable'));

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerVerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(replaceMock).toHaveBeenCalledWith('/auth/login?email=alice%40example.com&verification=retry');
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
          <CustomerVerifyEmailPage />
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
