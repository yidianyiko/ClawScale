import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

const readPublicUserLinkMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/user-link-api', () => ({
  readPublicUserLink: readPublicUserLinkMock,
}));

import UserLinkPage from './page';

describe('UserLinkPage', () => {
  it('shows provider profile and auth actions that preserve link_session', async () => {
    readPublicUserLinkMock.mockResolvedValueOnce({
    ok: true,
    data: {
      code: 'AbCdEfGhIjK_',
      profile: { displayName: 'Coach A', tagline: 'Strength coaching', avatarUrl: null },
      session: {
        nextUrl: '/auth/login?next=%2Fu%2FAbCdEfGhIjK_%3Flink_session%3Dtok',
        registerUrl: '/auth/register?next=%2Fu%2FAbCdEfGhIjK_%3Flink_session%3Dtok',
      },
    },
    });

    const html = renderToString(await UserLinkPage({ params: Promise.resolve({ code: 'AbCdEfGhIjK_' }) }));

    expect(readPublicUserLinkMock).toHaveBeenCalledWith('AbCdEfGhIjK_', { openSession: true });
    expect(html).toContain('Coach A');
    expect(html).toContain('Strength coaching');
    expect(html).toContain('/auth/login?next=');
    expect(html).toContain('link_session');
    expect(html).toContain('/u/AbCdEfGhIjK_/qr');
  });

  it('shows a clear inactive state for inactive or missing links', async () => {
    readPublicUserLinkMock.mockResolvedValueOnce({ ok: false, error: 'link_not_active' });

    const html = renderToString(await UserLinkPage({ params: Promise.resolve({ code: 'missing-code' }) }));

    expect(html).toContain('Link no longer active');
    expect(html).toContain('cannot create new connection sessions');
    expect(html).not.toContain('/auth/login?next=');
  });

  it('preserves an existing link session after auth instead of opening a new one', async () => {
    readPublicUserLinkMock.mockResolvedValueOnce({
      ok: true,
      data: {
        code: 'AbCdEfGhIjK_',
        profile: { displayName: 'Coach A', tagline: null, avatarUrl: null },
      },
    });

    const html = renderToString(
      await UserLinkPage({
        params: Promise.resolve({ code: 'AbCdEfGhIjK_' }),
        searchParams: Promise.resolve({ link_session: 'tok' }),
      }),
    );

    expect(readPublicUserLinkMock).toHaveBeenCalledWith('AbCdEfGhIjK_', { openSession: false });
    expect(html).toContain('Completing your connection');
    expect(html).toContain('link_session%3Dtok');
  });
});
