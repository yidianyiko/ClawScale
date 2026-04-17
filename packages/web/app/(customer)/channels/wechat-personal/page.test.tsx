import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import CustomerWechatPersonalPage from './page';

describe('CustomerWechatPersonalPage', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('forwards the neutral channel route into the legacy bind flow by default', async () => {
    await CustomerWechatPersonalPage({});

    expect(redirectMock).toHaveBeenCalledWith('/coke/bind-wechat');
  });

  it('forwards renewal-required auth flows into the legacy renew page', async () => {
    await CustomerWechatPersonalPage({
      searchParams: Promise.resolve({
        next: 'renew',
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/coke/renew');
  });
});
