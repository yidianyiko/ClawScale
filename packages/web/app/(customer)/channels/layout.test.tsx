import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../components/locale-provider';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import CustomerChannelsLayout from './layout';

describe('CustomerChannelsLayout', () => {
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

  it('renders the shared customer shell with locale controls for channel routes', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CustomerChannelsLayout>
            <div>body</div>
          </CustomerChannelsLayout>
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('.coke-site.customer-shell-page')).toBeTruthy();
    expect(container.querySelector('.customer-shell__nav')).toBeTruthy();
    expect(container.querySelector('a[href="/channels"]')).toBeTruthy();
    expect(container.querySelector('a[href="/account/subscription"]')).toBeTruthy();
    expect(container.textContent).toContain('统一管理客户登录与通道接入');
    expect(container.textContent).toContain('处理登录、验证与个人微信接入');
    expect(container.textContent).toContain('进入你的客户工作区');
    expect(container.textContent).toContain('EN');
    expect(container.textContent).toContain('中文');
  });
});
