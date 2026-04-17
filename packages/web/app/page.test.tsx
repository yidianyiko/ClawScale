import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

import { LocaleProvider } from '../components/locale-provider';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import HomePage from './page';

describe('HomePage', () => {
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

  it('renders English homepage copy under LocaleProvider', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <HomePage />
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('a[href="/auth/register"]')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(container.textContent).toContain('An AI Partner That Grows With You');
    expect(container.textContent).toContain('Platforms');
    expect(container.textContent).not.toContain('Register / 注册');
  });

  it('renders Chinese homepage copy under LocaleProvider', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <HomePage />
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('a[href="/auth/register"]')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(container.textContent).toContain('与您共同成长的 AI 助手');
    expect(container.textContent).toContain('平台');
    expect(container.textContent).not.toContain('Register / 注册');
  });
});
