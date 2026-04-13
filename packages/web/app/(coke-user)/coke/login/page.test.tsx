import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

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

import CokeLoginPage from './page';

describe('CokeLoginPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    pushMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
  });

  it('shows a forgot-password entry point', () => {
    flushSync(() => {
      root.render(<CokeLoginPage />);
    });

    expect(container.querySelector('a[href="/coke/forgot-password"]')).toBeTruthy();
  });
});
