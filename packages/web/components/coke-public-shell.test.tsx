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

  it('renders English shell navigation and CTA text without mixed labels', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CokePublicShell>
            <div>shell body</div>
          </CokePublicShell>
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('Platforms');
    expect(container.textContent).toContain('Features');
    expect(container.textContent).toContain('Architecture');
    expect(container.textContent).toContain('Contact');
    expect(container.textContent).toContain('Sign in');
    expect(container.textContent).toContain('Register');
    expect(container.textContent).toContain('An AI Partner That Grows With You');
    expect(container.textContent).not.toContain('Register / 注册');
    expect(container.textContent).not.toContain('Platforms / 平台');
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(container.querySelector('a[href="/auth/register"]')).toBeTruthy();
    expect(container.textContent).toContain('EN');
    expect(container.textContent).toContain('中文');
  });

  it('renders Chinese shell navigation and CTA text without mixed labels', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CokePublicShell>
            <div>shell body</div>
          </CokePublicShell>
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('平台');
    expect(container.textContent).toContain('功能');
    expect(container.textContent).toContain('架构');
    expect(container.textContent).toContain('联系');
    expect(container.textContent).toContain('登录');
    expect(container.textContent).toContain('注册');
    expect(container.textContent).toContain('与您共同成长的 AI 助手');
    expect(container.textContent).not.toContain('Register / 注册');
    expect(container.textContent).not.toContain('Platforms / 平台');
    expect(container.textContent).toContain('EN');
    expect(container.textContent).toContain('中文');
  });
});
