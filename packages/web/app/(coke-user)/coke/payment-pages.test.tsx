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

import PaymentCancelPage from './payment-cancel/page';
import PaymentSuccessPage from './payment-success/page';

describe('Coke payment pages', () => {
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

  it('renders English success-state copy from the locale catalog', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <PaymentSuccessPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('Payment complete');
    expect(container.textContent).toContain('Go to WeChat setup');
    expect(container.textContent).not.toContain('支付完成');
  });

  it('renders Chinese cancel-state copy from the locale catalog', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <PaymentCancelPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('支付已取消');
    expect(container.textContent).toContain('重新发起续费');
    expect(container.textContent).not.toContain('Payment canceled');
  });
});
