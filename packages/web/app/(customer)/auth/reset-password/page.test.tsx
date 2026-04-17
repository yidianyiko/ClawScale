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

import CustomerResetPasswordPage from './page';

describe('CustomerResetPasswordPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const waitForEffects = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  function setInputValue(selector: string, value: string) {
    const input = container.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(cokeUserApi.post).mockReset();
    window.history.pushState({}, '', '/auth/reset-password?token=token-123');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders Chinese reset-password copy with the auth forgot-password link', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CustomerResetPasswordPage />
        </LocaleProvider>,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('重置密码');
    expect(container.textContent).toContain('确认密码');
    expect(container.textContent).toContain('申请新的重置链接');
    expect(container.querySelector('a[href="/auth/forgot-password"]')).toBeTruthy();
    expect(container.textContent).not.toContain('Reset your password');
  });

  it('submits through the legacy Coke reset-password API and routes to /auth/login on success', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({ ok: true, data: {} });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerResetPasswordPage />
        </LocaleProvider>,
      );
    });

    await waitForEffects();

    setInputValue('#password', 'password-123');
    setInputValue('#confirmPassword', 'password-123');
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitForEffects();

    expect(vi.mocked(cokeUserApi.post)).toHaveBeenCalledWith('/api/coke/reset-password', {
      token: 'token-123',
      password: 'password-123',
    });
    expect(pushMock).toHaveBeenCalledWith('/auth/login');
  });
});
