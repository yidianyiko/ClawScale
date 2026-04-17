import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

const replaceMock = vi.hoisted(() => vi.fn());
const searchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams()));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => searchParamsMock(),
}));

import LegacyRedirectPage from './legacy-redirect-page';

async function flushTicks(count: number) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('LegacyRedirectPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    searchParamsMock.mockReset();
    searchParamsMock.mockReturnValue(new URLSearchParams());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('redirects to the target pathname when no query params are present', async () => {
    flushSync(() => {
      root.render(<LegacyRedirectPage pathname='/auth/login' />);
    });

    await flushTicks(2);

    expect(replaceMock).toHaveBeenCalledWith('/auth/login');
  });

  it('preserves query params when redirecting', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('email=alice%40example.com&verification=retry'));

    flushSync(() => {
      root.render(<LegacyRedirectPage pathname='/auth/login' />);
    });

    await flushTicks(2);

    expect(replaceMock).toHaveBeenCalledWith('/auth/login?email=alice%40example.com&verification=retry');
  });
});
