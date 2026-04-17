import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import LegacyBindWechatPage from './page';

describe('LegacyBindWechatPage redirect', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects the legacy bind route to the neutral customer channels page', async () => {
    await LegacyBindWechatPage({});

    expect(redirectMock).toHaveBeenCalledWith('/channels/wechat-personal');
  });

  it('preserves legacy bind query params when redirecting to the neutral route', async () => {
    await LegacyBindWechatPage({
      searchParams: Promise.resolve({
        next: 'renew',
        source: 'legacy',
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/channels/wechat-personal?next=renew&source=legacy');
  });
});
