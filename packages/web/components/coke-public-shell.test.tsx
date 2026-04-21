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

import { CokePublicShell } from './coke-public-shell';

describe('CokePublicShell', () => {
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

  it('renders the English shell contract without mixed locale labels', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CokePublicShell activeAuthCta="signIn">
            <div>shell body</div>
          </CokePublicShell>
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('.coke-site')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/login"][aria-current="page"]')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/register"]')).toBeTruthy();
    expect(container.textContent).toContain('Platforms');
    expect(container.textContent).toContain('Features');
    expect(container.textContent).toContain('Architecture');
    expect(container.textContent).toContain('Contact');
    expect(container.textContent).toContain('Sign in');
    expect(container.textContent).toContain('Register');
    expect(container.textContent?.toLowerCase()).toContain('coke');
    expect(container.textContent).toContain('EN');
    expect(container.textContent).toContain('中');
    expect(container.textContent).not.toContain('Register / 注册');
    expect(container.textContent).not.toContain('Platforms / 平台');
  });

  it('renders the Chinese shell contract without mixed locale labels', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CokePublicShell>
            <div>shell body</div>
          </CokePublicShell>
        </LocaleProvider>,
      );
    });

    expect(container.querySelector('.coke-site')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/register"]')).toBeTruthy();
    expect(container.textContent).toContain('平台');
    expect(container.textContent).toContain('功能');
    expect(container.textContent).toContain('架构');
    expect(container.textContent).toContain('联系');
    expect(container.textContent).toContain('登录');
    expect(container.textContent).toContain('注册');
    expect(container.textContent?.toLowerCase()).toContain('coke');
    expect(container.textContent).toContain('EN');
    expect(container.textContent).toContain('中');
    expect(container.textContent).not.toContain('Register / 注册');
    expect(container.textContent).not.toContain('Platforms / 平台');
  });
});
