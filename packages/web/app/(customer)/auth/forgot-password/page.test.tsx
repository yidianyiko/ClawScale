import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../../components/locale-provider';

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

import CustomerForgotPasswordPage from './page';

describe('CustomerForgotPasswordPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState({}, '', '/auth/forgot-password');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders English recovery copy with the auth login link', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerForgotPasswordPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('Forgot your password');
    expect(container.textContent).toContain('Send reset link');
    expect(container.textContent).toContain('Remembered your password?');
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(container.textContent).not.toContain('忘记密码');
  });
});
