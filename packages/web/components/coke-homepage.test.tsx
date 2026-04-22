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
    expect(container.querySelector('#platforms')).toBeTruthy();
    expect(container.querySelector('#features')).toBeTruthy();
    expect(container.querySelector('#architecture')).toBeTruthy();
    expect(container.querySelector('#contact')).toBeTruthy();
    expect(container.querySelector('.hero__title em')).toBeTruthy();
    expect(container.textContent).toContain('WeChat');
    expect(container.textContent).toContain('Telegram');
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

    expect(container.textContent).toContain('AI 助手');
    expect(container.textContent).toContain('不断进化的');
  });
});
