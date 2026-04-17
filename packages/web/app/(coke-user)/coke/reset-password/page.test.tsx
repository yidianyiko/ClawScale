import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import ResetPasswordPage from './page';

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects /coke/reset-password to /auth/reset-password while preserving query params', async () => {
    await ResetPasswordPage({
      searchParams: Promise.resolve({
        token: 'token-123',
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/auth/reset-password?token=token-123');
  });
});
