import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth } from '../../../../lib/coke-user-auth';
import { storeCustomerAuth } from '../../../../lib/customer-auth';

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

vi.mock('../../../../lib/customer-auth', () => ({
  storeCustomerAuth: vi.fn(),
}));

import CustomerRegisterPage from './page';

describe('CustomerRegisterPage', () => {
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
    vi.mocked(cokeUserApi.post).mockReset();
    vi.mocked(storeCokeUserAuth).mockReset();
    vi.mocked(storeCustomerAuth).mockReset();
    window.history.replaceState({}, '', '/auth/register');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders Chinese registration copy at /auth/register without mixed English labels', () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <CustomerRegisterPage />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toContain('创建你的 Coke 账号');
    expect(container.textContent).toContain('已经注册？');
    expect((container.querySelector('input#password') as HTMLInputElement | null)?.placeholder).toBe(
      '创建一个密码',
    );
    expect(container.querySelector('a[href="/auth/login"]')).toBeTruthy();
    expect(container.textContent).not.toContain('Register / 注册');
    expect(container.textContent).not.toContain('Create your Coke account');
  });

  it('submits through the legacy Coke register API and routes to /auth/verify-email on success', async () => {
    vi.mocked(cokeUserApi.post).mockResolvedValueOnce({
      ok: true,
      data: {
        token: 'auth-token',
        user: {
          id: 'acct_1',
          email: 'alice@example.com',
          display_name: 'Alice',
          email_verified: false,
          status: 'normal',
          subscription_active: false,
          subscription_expires_at: null,
        },
        customerAuth: {
          token: 'customer-token',
          customerId: 'ck_1',
          identityId: 'idt_1',
          email: 'alice@example.com',
          claimStatus: 'active',
          membershipRole: 'owner',
        },
      },
    });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <CustomerRegisterPage />
        </LocaleProvider>,
      );
    });

    setInputValue('#displayName', 'Alice');
    setInputValue('#email', 'alice@example.com');
    setInputValue('#password', 'password-123');

    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitForEffects();

    expect(vi.mocked(cokeUserApi.post)).toHaveBeenCalledWith('/api/coke/register', {
      displayName: 'Alice',
      email: 'alice@example.com',
      password: 'password-123',
    });
    expect(vi.mocked(storeCokeUserAuth)).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'auth-token',
      }),
    );
    expect(vi.mocked(storeCustomerAuth)).toHaveBeenCalledWith({
      token: 'customer-token',
      customerId: 'ck_1',
      identityId: 'idt_1',
      email: 'alice@example.com',
      claimStatus: 'active',
      membershipRole: 'owner',
    });
    expect(pushMock).toHaveBeenCalledWith('/auth/verify-email');
  });
});
