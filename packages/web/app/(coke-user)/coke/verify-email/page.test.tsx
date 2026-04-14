import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../components/locale-provider';

const pushMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const getCokeUserMock = vi.hoisted(() => vi.fn());
const storeCokeUserAuthMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: pushMock,
  }),
}));

vi.mock('../../../../lib/coke-user-api', () => ({
  cokeUserApi: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock('../../../../lib/coke-user-auth', () => ({
  getCokeUser: () => getCokeUserMock(),
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
    postMock.mockReset();
    getCokeUserMock.mockReset();
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
    getCokeUserMock.mockReturnValue(null);
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

  it('submits the verification token to the Gateway contract', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(1);

    expect((container.querySelector('input#token') as HTMLInputElement | null)?.value).toBe('verify-token');
    expect((container.querySelector('input#email') as HTMLInputElement | null)?.value).toBe('alice@example.com');
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await flushTicks(1);

    expect(postMock).toHaveBeenCalledWith('/api/coke/verify-email', {
      token: 'verify-token',
      email: 'alice@example.com',
    });
    expect(pushMock).toHaveBeenCalledWith('/coke/bind-wechat');
  });

  it('resends a verification email from the current email field', async () => {
    postMock.mockResolvedValue({
      ok: true,
      data: {
        message: 'If the account exists, a verification email has been sent.',
      },
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(1);

    const resendButton = container.querySelector('[data-testid="resend-email"]');
    resendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushTicks(1);

    expect(postMock).toHaveBeenCalledWith('/api/coke/verify-email/resend', {
      email: 'alice@example.com',
    });
    expect(container.textContent).toContain('If the account exists, a verification email has been sent.');
  });

  it('falls back to the stored Coke user email when the query string omits email', async () => {
    getCokeUserMock.mockReturnValue({
      id: 'acct_1',
      email: 'stored@example.com',
      display_name: 'Alice',
    });
    postMock.mockResolvedValue({
      ok: true,
      data: {
        message: 'If the account exists, a verification email has been sent.',
      },
    });
    window.history.pushState({}, '', '/coke/verify-email?token=verify-token');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(1);

    expect((container.querySelector('input#email') as HTMLInputElement | null)?.value).toBe(
      'stored@example.com',
    );

    const resendButton = container.querySelector('[data-testid="resend-email"]');
    resendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushTicks(1);

    expect(postMock).toHaveBeenCalledWith('/api/coke/verify-email/resend', {
      email: 'stored@example.com',
    });
  });

  it('renders Chinese verification copy without mixed English labels', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <VerifyEmailPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(1);

    expect(container.textContent).toContain('验证邮箱');
    expect(container.textContent).toContain('重新发送验证邮件');
    expect(container.textContent).not.toContain('Verify your email');
    expect(container.textContent).not.toContain('Resend verification email');
  });
});
