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

vi.mock('../../../../lib/coke-user-auth', () => ({
  storeCokeUserAuth: vi.fn(),
}));

import CokeLoginPage from './page';

describe('CokeLoginPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pushMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
  });

  it('renders English account copy and entry links without mixed labels', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CokeLoginPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('Sign in to Coke');
    expect(container.textContent).toContain('Return to your Coke account');
    expect(container.textContent).not.toContain('Sign in / 登录');
    expect(container.textContent).not.toContain('Email / 邮箱');
    expect(container.querySelector('a[href="/"]')).toBeTruthy();
    expect(container.querySelector('a[href="/coke/forgot-password"]')).toBeTruthy();
    expect(container.querySelector('a[href="/coke/register"]')).toBeTruthy();
  });

  it('renders Chinese account copy without English fallback text in the UI copy', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CokeLoginPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('登录 Coke');
    expect(container.textContent).toContain('返回你的 Coke 账号');
    expect(container.textContent).toContain('返回首页');
    expect(container.textContent).not.toContain('Sign in to Coke');
    expect(container.textContent).not.toContain('Back to homepage');
  });
});
