import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import VerifyEmailPage from './page';

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects /coke/verify-email to /auth/verify-email while preserving query params', async () => {
    await VerifyEmailPage({
      searchParams: Promise.resolve({
        token: 'verify-token',
        email: 'alice@example.com',
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/auth/verify-email?token=verify-token&email=alice%40example.com');
  });
});
