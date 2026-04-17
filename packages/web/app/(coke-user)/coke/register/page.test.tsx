import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import CokeRegisterPage from './page';

describe('CokeRegisterPage', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects /coke/register to /auth/register', async () => {
    await CokeRegisterPage({});

    expect(redirectMock).toHaveBeenCalledWith('/auth/register');
  });
});
