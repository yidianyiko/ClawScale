import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../components/locale-provider';

const replaceMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const getCokeUserTokenMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock('../../../../lib/coke-user-auth', () => ({
  getCokeUserToken: () => getCokeUserTokenMock(),
}));

vi.mock('../../../../lib/coke-user-api', () => ({
  cokeUserApi: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

import RenewPage from './page';

async function flushTicks(count: number) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('RenewPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    openMock.mockReset();
    getCokeUserTokenMock.mockReset();
    postMock.mockReset();
    getCokeUserTokenMock.mockReturnValue('token');
    postMock.mockResolvedValue({ ok: true, data: { url: 'https://checkout.stripe.com/pay/cs_test_1' } });
    vi.spyOn(window, 'open').mockImplementation(openMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    root?.unmount();
    container?.remove();
  });

  it('creates a checkout session after login and navigates to the returned url', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <RenewPage />
        </LocaleProvider>,
      );
    });

    await Promise.resolve();

    expect(postMock).toHaveBeenCalledWith('/api/coke/checkout');
    expect(openMock).toHaveBeenCalledWith('https://checkout.stripe.com/pay/cs_test_1', '_self');
  });

  it('redirects unauthenticated users without showing the renewal fallback actions', async () => {
    getCokeUserTokenMock.mockReturnValue(null);

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <RenewPage />
        </LocaleProvider>,
      );
    });

    await Promise.resolve();

    expect(replaceMock).toHaveBeenCalledWith('/coke/login?next=/coke/renew');
    expect(postMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Return to checkout when you are ready.');
    expect(container.querySelector('a[href="/coke/login"]')).toBeNull();
  });

  it('renders English renewal fallback copy when checkout setup fails', async () => {
    postMock.mockResolvedValueOnce({ ok: false, error: 'Checkout unavailable' });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <RenewPage />
        </LocaleProvider>,
      );
    });

    await flushTicks(2);

    expect(container.textContent).toContain('Renew your access');
    expect(container.textContent).toContain('Unable to start renewal right now.');
    expect(container.textContent).toContain('Sign in');
    expect(container.textContent).toContain('Back to setup');
    expect(container.textContent).not.toContain('续订访问');
  });
});
