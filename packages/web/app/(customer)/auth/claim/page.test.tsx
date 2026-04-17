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

vi.mock('../../../../lib/customer-api', () => ({
  customerApi: {
    post: vi.fn(),
  },
}));

vi.mock('../../../../lib/customer-auth', () => ({
  storeCustomerAuth: vi.fn(),
}));

import { customerApi } from '../../../../lib/customer-api';
import { storeCustomerAuth } from '../../../../lib/customer-auth';
import ClaimPage from './page';

describe('ClaimPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const waitForEffects = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  function setInputValue(selector: string, value: string) {
    const input = container.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(customerApi.post).mockReset();
    vi.mocked(storeCustomerAuth).mockReset();
    window.history.replaceState({}, '', '/auth/claim?token=claim-token-123');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders the current claim form, prefills the token from the URL, and keeps the auth login link', async () => {
    flushSync(() => {
      root.render(<ClaimPage />);
    });

    await waitForEffects();

    expect(container.textContent).toContain('Claim your customer account');
    expect(container.textContent).toContain('Activate account');
    expect((container.querySelector('#token') as HTMLInputElement).value).toBe('claim-token-123');
    expect(window.location.search).toBe('');
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
  });

  it('stores the customer auth payload and routes to /channels after a successful claim', async () => {
    vi.mocked(customerApi.post).mockResolvedValueOnce({
      ok: true,
      data: {
        token: 'customer-token',
        customerId: 'ck_1',
        identityId: 'idt_1',
        email: 'alice@example.com',
        claimStatus: 'active',
        membershipRole: 'owner',
      },
    });

    flushSync(() => {
      root.render(<ClaimPage />);
    });

    await waitForEffects();

    setInputValue('#password', 'password-123');
    setInputValue('#confirmPassword', 'password-123');
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitForEffects();

    expect(vi.mocked(customerApi.post)).toHaveBeenCalledWith('/api/auth/claim', {
      token: 'claim-token-123',
      password: 'password-123',
    });
    expect(vi.mocked(storeCustomerAuth)).toHaveBeenCalledWith({
      token: 'customer-token',
      customerId: 'ck_1',
      identityId: 'idt_1',
      email: 'alice@example.com',
      claimStatus: 'active',
      membershipRole: 'owner',
    });
    expect(pushMock).toHaveBeenCalledWith('/channels');
  });

  it('shows the invalid-or-expired token error without routing', async () => {
    vi.mocked(customerApi.post).mockResolvedValueOnce({
      ok: false,
      error: 'invalid_or_expired_token',
    });

    flushSync(() => {
      root.render(<ClaimPage />);
    });

    await waitForEffects();

    setInputValue('#password', 'password-123');
    setInputValue('#confirmPassword', 'password-123');
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitForEffects();

    expect(container.textContent).toContain('This claim link is invalid or has expired.');
    expect(pushMock).not.toHaveBeenCalled();
    expect(vi.mocked(storeCustomerAuth)).not.toHaveBeenCalled();
  });
});
