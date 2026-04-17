import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import CokeLoginPage from './page';

describe('CokeLoginPage', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects /coke/login to /auth/login while preserving query params', async () => {
    await CokeLoginPage({
      searchParams: Promise.resolve({
        email: 'alice@example.com',
        verification: 'retry',
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/auth/login?email=alice%40example.com&verification=retry');
  });
});
