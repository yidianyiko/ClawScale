import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../../components/locale-provider';

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

import ResetPasswordPage from './page';

describe('ResetPasswordPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pushMock.mockReset();
    window.history.pushState({}, '', '/coke/reset-password?token=token-123');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders Chinese reset-password copy without English fallback text', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <ResetPasswordPage />
        </LocaleProvider>,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('重置密码');
    expect(container.textContent).toContain('确认密码');
    expect(container.textContent).toContain('申请新的重置链接');
    expect(container.textContent).not.toContain('Reset your password');
  });
});
