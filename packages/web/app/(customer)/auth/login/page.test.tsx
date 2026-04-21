import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../../components/locale-provider';
import { customerApi } from '../../../../lib/customer-api';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth } from '../../../../lib/coke-user-auth';
import { clearCustomerAuth, storeCustomerAuth } from '../../../../lib/customer-auth';

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

vi.mock('../../../../lib/customer-api', () => ({
  customerApi: {
    get: vi.fn(),
  },
}));

vi.mock('../../../../lib/coke-user-auth', () => ({
  storeCokeUserAuth: vi.fn(),
}));

vi.mock('../../../../lib/customer-auth', () => ({
  storeCustomerAuth: vi.fn(),
  clearCustomerAuth: vi.fn(),
}));

import CustomerLoginPage from './page';

function makeCustomerAuthResult() {
  return {
    token: 'customer-token',
    customerId: 'ck_1',
    identityId: 'idt_1',
    email: 'alice@example.com',
    claimStatus: 'active' as const,
    membershipRole: 'owner' as const,
  };
}

function makeCokeProfile(overrides: Partial<{
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  status: 'normal' | 'suspended';
  subscription_active: boolean;
  subscription_expires_at: string | null;
}> = {}) {
  return {
    id: 'ck_1',
    email: 'alice@example.com',
    display_name: 'Alice',
    email_verified: true,
    status: 'normal' as const,
    subscription_active: true,
    subscription_expires_at: null,
    ...overrides,
  };
}

describe('CustomerLoginPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  async function flushTicks(count: number) {
    for (let i = 0; i < count; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function setInputValue(selector: string, value: string) {
    const input = container.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function submitLoginForm(email = 'alice@example.com', password = 'password-123') {
    setInputValue('#email', email);
    setInputValue('#password', password);
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushTicks(3);
  }

  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(cokeUserApi.post).mockReset();
    vi.mocked(customerApi.get).mockReset();
    vi.mocked(storeCokeUserAuth).mockReset();
    vi.mocked(storeCustomerAuth).mockReset();
    vi.mocked(clearCustomerAuth).mockReset();
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
    await flushTicks(1);

    expect(container.querySelector('.auth-card')).toBeTruthy();
    expect(container.querySelector('.auth-form')).toBeTruthy();
    expect(container.querySelector('.auth-input#email')).toBeTruthy();
    expect(container.querySelector('.auth-submit')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/register"]')).toBeTruthy();

    const links = Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href'));

    expect(container.textContent).toContain('Sign in to Coke');
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
    await flushTicks(1);

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
    await flushTicks(1);

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
    await flushTicks(1);

    const button = container.querySelector('button[type="button"]') as HTMLButtonElement;
    button.click();

    await flushTicks(1);

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Sending verification email...');

    resolveResend({ ok: true, data: {} });
    await flushTicks(1);

    expect(vi.mocked(cokeUserApi.post)).toHaveBeenCalledWith('/api/auth/resend-verification', {
      email: 'alice@example.com',
    });
    expect(container.textContent).toContain('Verification email sent.');
  });

  it('keeps unverified login attempts on the recovery flow after neutral login and profile hydration', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: makeCustomerAuthResult(),
    });
    vi.mocked(customerApi.get).mockResolvedValueOnce({
      ok: true,
      data: makeCokeProfile({
        email_verified: false,
      }),
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    await submitLoginForm();

    expect(vi.mocked(cokeUserApi.post)).toHaveBeenCalledWith('/api/auth/login', {
      email: 'alice@example.com',
      password: 'password-123',
    });
    expect(vi.mocked(customerApi.get)).toHaveBeenCalledWith('/api/coke/me');
    expect(vi.mocked(storeCustomerAuth)).toHaveBeenCalledWith(makeCustomerAuthResult());
    expect(vi.mocked(storeCokeUserAuth)).toHaveBeenCalledWith({
      token: 'customer-token',
      user: expect.objectContaining({
        email_verified: false,
      }),
    });
    expect(pushMock).not.toHaveBeenCalledWith('/auth/verify-email');
    expect(container.textContent).toContain('This link is invalid or expired.');
    expect(container.querySelector('button[type="button"]')).toBeTruthy();
  });

  it('routes renewal-required login success through the neutral channel path', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: makeCustomerAuthResult(),
    });
    vi.mocked(customerApi.get).mockResolvedValueOnce({
      ok: true,
      data: makeCokeProfile({
        subscription_active: false,
      }),
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    await submitLoginForm();

    expect(vi.mocked(storeCustomerAuth)).toHaveBeenCalledWith(makeCustomerAuthResult());
    expect(vi.mocked(storeCokeUserAuth)).toHaveBeenCalledWith({
      token: 'customer-token',
      user: expect.objectContaining({
        subscription_active: false,
      }),
    });
    expect(pushMock).toHaveBeenCalledWith('/channels/wechat-personal?next=renew');
    expect(pushMock).not.toHaveBeenCalledWith('/coke/renew');
  });

  it('stores the neutral customer session and hydrated Coke profile before routing to the channel surface', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: makeCustomerAuthResult(),
    });
    vi.mocked(customerApi.get).mockResolvedValueOnce({
      ok: true,
      data: makeCokeProfile(),
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    await submitLoginForm();

    expect(vi.mocked(storeCustomerAuth)).toHaveBeenCalledWith(makeCustomerAuthResult());
    expect(vi.mocked(storeCokeUserAuth)).toHaveBeenCalledWith({
      token: 'customer-token',
      user: makeCokeProfile(),
    });
    expect(pushMock).toHaveBeenCalledWith('/channels/wechat-personal');
  });

  it('shows a generic error and does not route when the compatibility profile cannot be loaded', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: makeCustomerAuthResult(),
    });
    vi.mocked(customerApi.get).mockResolvedValueOnce({
      ok: false,
      error: 'account_not_found',
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    await submitLoginForm();

    expect(vi.mocked(storeCustomerAuth)).toHaveBeenCalledWith(makeCustomerAuthResult());
    expect(vi.mocked(storeCokeUserAuth)).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Unable to sign in right now.');
  });

  it('preserves a safe neutral internal next destination after login', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: makeCustomerAuthResult(),
    });
    vi.mocked(customerApi.get).mockResolvedValueOnce({
      ok: true,
      data: makeCokeProfile(),
    });
    window.history.replaceState({}, '', '/auth/login?next=%2Fchannels%2Fwechat-personal%3Fsource%3Dauth');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    await submitLoginForm();

    expect(pushMock).toHaveBeenCalledWith('/channels/wechat-personal?source=auth');
  });

  it('falls back to the neutral default when next is an unsafe external target', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: makeCustomerAuthResult(),
    });
    vi.mocked(customerApi.get).mockResolvedValueOnce({
      ok: true,
      data: makeCokeProfile(),
    });
    window.history.replaceState({}, '', '/auth/login?next=https%3A%2F%2Fevil.example%2Fphish');

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerLoginPage />
        </LocaleProvider>,
      );
    });

    await submitLoginForm();

    expect(pushMock).toHaveBeenCalledWith('/channels/wechat-personal');
    expect(pushMock).not.toHaveBeenCalledWith('https://evil.example/phish');
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
