import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps, ReactNode } from 'react';
import { LocaleProvider } from '../../../components/locale-provider';

const replaceMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const isAdminAuthenticatedMock = vi.hoisted(() => vi.fn());
const getStoredAdminSessionMock = vi.hoisted(() => vi.fn());
const clearAdminSessionMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
  usePathname: () => '/admin/customers',
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

vi.mock('../../../lib/admin-auth', () => ({
  isAdminAuthenticated: () => isAdminAuthenticatedMock(),
  getStoredAdminSession: () => getStoredAdminSessionMock(),
  clearAdminSession: () => clearAdminSessionMock(),
}));

import AdminLayout from './layout';

describe('AdminLayout', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    pushMock.mockReset();
    isAdminAuthenticatedMock.mockReset();
    getStoredAdminSessionMock.mockReset();
    clearAdminSessionMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('redirects unauthenticated admins to /admin/login', async () => {
    isAdminAuthenticatedMock.mockReturnValue(false);

    await flushSync(async () => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminLayout>
            <div>admin body</div>
          </AdminLayout>
        </LocaleProvider>,
      );
    });

    expect(replaceMock).toHaveBeenCalledWith('/admin/login');
  });
});
