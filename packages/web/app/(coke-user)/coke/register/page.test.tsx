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

import CokeRegisterPage from './page';

describe('CokeRegisterPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pushMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders Chinese registration copy without mixed English labels', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CokeRegisterPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('创建你的 Coke 账号');
    expect(container.textContent).toContain('已经注册？');
    expect((container.querySelector('input#password') as HTMLInputElement | null)?.placeholder).toBe(
      '创建一个密码',
    );
    expect(container.textContent).not.toContain('Register / 注册');
    expect(container.textContent).not.toContain('Create your Coke account');
  });
});
