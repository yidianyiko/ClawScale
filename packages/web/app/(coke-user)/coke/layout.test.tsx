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

import CokeUserLayout from './layout';

describe('CokeUserLayout', () => {
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

  it('renders Chinese shell copy with the locale switcher', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CokeUserLayout>
            <div>body</div>
          </CokeUserLayout>
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('管理订阅与 Coke 业务状态');
    expect(container.textContent).toContain('管理 Coke 账单与交付状态');
    expect(container.textContent).toContain('保持你的 Coke 服务处于启用状态');
    expect(container.textContent).toContain('EN');
    expect(container.textContent).toContain('中文');
    expect(container.textContent).not.toContain('统一管理客户登录与通道接入');
  });
});
