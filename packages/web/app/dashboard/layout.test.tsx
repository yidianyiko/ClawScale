import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps, ReactNode } from 'react';
import { LocaleProvider } from '../../components/locale-provider';

const replaceMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const isAuthenticatedMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const getTenantMock = vi.hoisted(() => vi.fn());
const clearAuthMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
  usePathname: () => '/dashboard',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('../../lib/auth', () => ({
  isAuthenticated: () => isAuthenticatedMock(),
  clearAuth: () => clearAuthMock(),
  getUser: () => getUserMock(),
  getTenant: () => getTenantMock(),
}));

import DashboardLayout from './layout';

describe('DashboardLayout', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    pushMock.mockReset();
    isAuthenticatedMock.mockReset();
    getUserMock.mockReset();
    getTenantMock.mockReset();
    clearAuthMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('redirects unauthenticated members to /dashboard/login', async () => {
    isAuthenticatedMock.mockReturnValue(false);

    await flushSync(async () => {
      root.render(
        <LocaleProvider initialLocale="en">
          <DashboardLayout>
            <div>dashboard body</div>
          </DashboardLayout>
        </LocaleProvider>,
      );
    });

    expect(replaceMock).toHaveBeenCalledWith('/dashboard/login');
  });

  it('renders localized navigation for authenticated users', async () => {
    isAuthenticatedMock.mockReturnValue(true);
    getUserMock.mockReturnValue({ id: 'u1', name: 'Alice', role: 'admin' });
    getTenantMock.mockReturnValue({ id: 't1', name: 'Acme' });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <DashboardLayout>
            <div>dashboard body</div>
          </DashboardLayout>
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('总览');
      expect(container.textContent).toContain('AI 后端');
      expect(container.textContent).toContain('语言');
      expect(container.querySelector('button[title="退出登录"]')).toBeTruthy();
    });
  });
});
