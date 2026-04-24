import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

import { LocaleProvider } from './locale-provider';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CokeHomepage } from './coke-homepage';

describe('CokeHomepage', () => {
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

  it('renders all editorial sections in English', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CokeHomepage />
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('.coke-site')).toBeTruthy();
    expect(container.querySelector('a[href="/"][aria-label="Kap AI"]')).toBeTruthy();
    expect(container.querySelector('img[alt="Kap koala badge"]')).toBeTruthy();
    expect(container.querySelector('#capabilities')).toBeTruthy();
    expect(container.querySelector('#scenarios')).toBeTruthy();
    expect(container.querySelector('#voices')).toBeTruthy();
    expect(container.querySelector('#download')).toBeTruthy();
    expect(container.querySelector('.ticker')).toBeTruthy();
    expect(container.querySelector('.hero__title em')).toBeTruthy();
    expect(container.querySelector('.hero-mascot-figure')).toBeTruthy();
    expect(container.querySelector('img[alt="Kap koala mascot"]')).toBeTruthy();
    expect(container.textContent).toContain('Kap AI');
    expect(container.textContent).toContain('© 2026 Kap AI');
    expect(container.textContent).toContain('WeChat');
    expect(container.textContent).toContain('Telegram');
    expect(container.textContent).toContain('Plan meetings, reminders, and the next move in one thread.');
    expect(container.textContent).toContain('Turn the loose thought into a sendable message.');
    expect(container.textContent).not.toContain('Not just a new coat of paint');
    expect(container.textContent).not.toContain('one public experience that feels coherent');
    expect(container.querySelector('a[href="/channels/wechat-personal"]')).toBeTruthy();
    expect(container.querySelector('a[href="/account/subscription"]')).toBeTruthy();
  });

  it('renders Chinese hero copy', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CokeHomepage />
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('a[href="/"][aria-label="Kap AI"]')).toBeTruthy();
    expect(container.querySelector('img[alt="Kap koala badge"]')).toBeTruthy();
    expect(container.querySelector('img[alt="Kap koala mascot"]')).toBeTruthy();
    expect(container.textContent).toContain('AI 助手');
    expect(container.textContent).toContain('不断进化的');
    expect(container.textContent).toContain('Kap AI');
    expect(container.textContent).toContain('© 2026 Kap AI');
    expect(container.textContent).toContain('把会议、提醒和下一步放进同一个线程里。');
    expect(container.textContent).toContain('把要发出去的那条消息先起草出来。');
    expect(container.textContent).not.toContain('不是只把页面换个颜色');
    expect(container.textContent).not.toContain('这轮改版把主页、认证、客户页面和全球入口统一成同一种产品语言');
    expect(container.textContent).not.toContain('让公开站点更像产品');
  });
});
