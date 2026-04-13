import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps, ReactNode } from 'react';

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
        <DashboardLayout>
          <div>dashboard body</div>
        </DashboardLayout>,
      );
    });

    expect(replaceMock).toHaveBeenCalledWith('/dashboard/login');
  });
});
