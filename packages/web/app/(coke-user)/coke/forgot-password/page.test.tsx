import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import ForgotPasswordPage from './page';

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects /coke/forgot-password to /auth/forgot-password', async () => {
    await ForgotPasswordPage({});

    expect(redirectMock).toHaveBeenCalledWith('/auth/forgot-password');
  });
});
