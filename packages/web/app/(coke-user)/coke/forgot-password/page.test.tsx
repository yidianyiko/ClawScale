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

import ForgotPasswordPage from './page';

describe('ForgotPasswordPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders English recovery copy from the locale catalog', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <ForgotPasswordPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('Forgot your password');
    expect(container.textContent).toContain('Send reset link');
    expect(container.textContent).toContain('Remembered your password?');
    expect(container.textContent).not.toContain('忘记密码');
  });
});
