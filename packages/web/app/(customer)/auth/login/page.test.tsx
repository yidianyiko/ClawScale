import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';

const pushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../../../lib/coke-user-api', () => ({
  cokeUserApi: {
    post: vi.fn(),
  },
}));

vi.mock('../../../../lib/coke-user-auth', () => ({
  storeCokeUserAuth: vi.fn(),
}));

import CustomerLoginPage from './page';

describe('CustomerLoginPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const waitForEffects = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(cokeUserApi.post).mockReset();
    window.history.replaceState({}, '', '/auth/login');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
  });

  it('renders the customer login experience at /auth/login with auth route links', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });
    await waitForEffects();

    const links = Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'));

    expect(container.textContent).toContain('Return to your Coke account');
    expect(links).toContain('/auth/forgot-password');
    expect(links).toContain('/auth/register');
  });

  it('prefills the email and shows recovery copy from an expired verification link', async () => {
    window.history.replaceState({}, '', '/auth/login?email=alice%40example.com&verification=expired');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });
    await waitForEffects();

    expect((container.querySelector('#email') as HTMLInputElement).value).toBe('alice@example.com');
    expect(container.textContent).toContain('This link is invalid or expired.');
    expect(container.textContent).toContain('Resend verification email');
    expect(container.querySelector('button[type="button"]')).toBeTruthy();
  });

  it('shows retry recovery copy when verification could not be completed right now', async () => {
    window.history.replaceState({}, '', '/auth/login?email=alice%40example.com&verification=retry');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });
    await waitForEffects();

    expect((container.querySelector('#email') as HTMLInputElement).value).toBe('alice@example.com');
    expect(container.textContent).toContain("We couldn't verify your email right now.");
    expect(container.textContent).toContain('Resend verification email');
    expect(container.querySelector('button[type="button"]')).toBeTruthy();
  });

  it('calls the resend endpoint with the current email from recovery state', async () => {
    let resolveResend: (value: { ok: boolean; data: Record<string, never> }) => void = () => {};
    const resendPromise = new Promise<{ ok: boolean; data: Record<string, never> }>((resolve) => {
      resolveResend = resolve;
    });
    vi.mocked(cokeUserApi.post).mockReturnValueOnce(resendPromise);

    window.history.replaceState({}, '', '/auth/login?email=alice%40example.com&verification=expired');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });
    await waitForEffects();

    const button = container.querySelector('button[type="button"]') as HTMLButtonElement;
    button.click();

    await waitForEffects();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Sending verification email...');

    resolveResend({ ok: true, data: {} });
    await waitForEffects();

    expect(vi.mocked(cokeUserApi.post)).toHaveBeenCalledWith('/api/coke/verify-email/resend', {
      email: 'alice@example.com',
    });
    expect(container.textContent).toContain('Verification email sent.');
  });

  it('keeps unverified login attempts on the recovery flow instead of routing to verify-email', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: {
        token: 'auth-token',
        user: {
          id: 'acct_1',
          email: 'alice@example.com',
          display_name: 'Alice',
          email_verified: false,
          status: 'normal',
          subscription_active: true,
          subscription_expires_at: null,
        },
      },
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitForEffects();

    expect(vi.mocked(cokeUserApi.post)).toHaveBeenCalledWith('/api/coke/login', expect.any(Object));
    expect(pushMock).not.toHaveBeenCalledWith('/auth/verify-email');
    expect(container.textContent).toContain('This link is invalid or expired.');
    expect(container.querySelector('button[type="button"]')).toBeTruthy();
  });

  it('only shows the resend button in verification recovery state', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('button[type="button"]')).toBeNull();
    expect(container.textContent).not.toContain('重新发送验证邮件');
  });
});
