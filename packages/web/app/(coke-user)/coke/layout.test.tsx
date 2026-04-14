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

    expect(container.textContent).toContain('公开入口与个人账号流程');
    expect(container.textContent).toContain('管理你的个人微信通道');
    expect(container.textContent).toContain('进入你的个人 AI 工作区');
    expect(container.textContent).toContain('EN');
    expect(container.textContent).toContain('中文');
    expect(container.textContent).not.toContain('Public access and personal account flow');
  });
});
