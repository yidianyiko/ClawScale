import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

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

  it('links public visitors to Coke registration and sign-in from the homepage', () => {
    flushSync(() => {
      root.render(<HomePage />);
    });

    expect(container.querySelector('a[href="/coke/register"]')).toBeTruthy();
    expect(container.querySelector('a[href="/coke/login"]')).toBeTruthy();
    expect(container.textContent).toContain('An AI Partner That Grows With You');
  });
});
