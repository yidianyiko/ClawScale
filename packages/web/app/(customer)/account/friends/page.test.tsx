import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { LocaleProvider } from '../../../../components/locale-provider';

const replaceMock = vi.hoisted(() => vi.fn());
const getLinkMock = vi.hoisted(() => vi.fn());
const listRequestsMock = vi.hoisted(() => vi.fn());
const listFriendsMock = vi.hoisted(() => vi.fn());
const acceptMock = vi.hoisted(() => vi.fn());
const rejectMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
const resetLinkMock = vi.hoisted(() => vi.fn());
const disableLinkMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('../../../../lib/customer-friends', () => ({
  getCustomerFriendLink: (...args: unknown[]) => getLinkMock(...args),
  listCustomerFriendRequests: (...args: unknown[]) => listRequestsMock(...args),
  listCustomerFriends: (...args: unknown[]) => listFriendsMock(...args),
  acceptCustomerFriendRequest: (...args: unknown[]) => acceptMock(...args),
  rejectCustomerFriendRequest: (...args: unknown[]) => rejectMock(...args),
  cancelCustomerFriendRequest: (...args: unknown[]) => cancelMock(...args),
  removeCustomerFriend: (...args: unknown[]) => removeMock(...args),
  resetCustomerFriendLink: (...args: unknown[]) => resetLinkMock(...args),
  disableCustomerFriendLink: (...args: unknown[]) => disableLinkMock(...args),
}));

import FriendsPage from './page';

function friendLink(overrides: Record<string, unknown> = {}) {
  return {
    code: 'friend-code',
    status: 'active',
    url: 'https://kap.example/u/friend-code',
    qrUrl: 'https://kap.example/u/friend-code/qr',
    profile: {
      displayName: 'Mina',
      tagline: null,
      avatarUrl: null,
    },
    ...overrides,
  };
}

function friendRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    status: 'pending',
    direction: 'incoming',
    counterpartAccountId: 'acct_1',
    ...overrides,
  };
}

function friend(overrides: Record<string, unknown> = {}) {
  return {
    id: 'friendship-1',
    status: 'active',
    counterpartAccountId: 'acct_3',
    counterpartProfile: {
      displayName: 'Rin',
      avatarUrl: null,
    },
    ...overrides,
  };
}

async function flushTicks(count = 4) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function findButton(container: HTMLElement, label: string) {
  return [...container.querySelectorAll('button')].find((button) => button.textContent === label);
}

describe('CustomerFriendsPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeTextMock: ReturnType<typeof vi.fn>;

  function renderPage() {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <FriendsPage />
        </LocaleProvider>,
      );
    });
  }

  beforeEach(() => {
    replaceMock.mockReset();
    getLinkMock.mockReset();
    listRequestsMock.mockReset();
    listFriendsMock.mockReset();
    acceptMock.mockReset();
    rejectMock.mockReset();
    cancelMock.mockReset();
    removeMock.mockReset();
    resetLinkMock.mockReset();
    disableLinkMock.mockReset();
    getLinkMock.mockResolvedValue({ ok: true, data: friendLink() });
    listRequestsMock.mockResolvedValue({
      ok: true,
      data: [
        friendRequest({ id: 'incoming-1', direction: 'incoming', counterpartAccountId: 'acct_incoming' }),
        friendRequest({ id: 'outgoing-1', direction: 'outgoing', counterpartAccountId: 'acct_outgoing' }),
        friendRequest({
          id: 'incoming-accepted',
          status: 'accepted',
          direction: 'incoming',
          counterpartAccountId: 'acct_done',
        }),
      ],
    });
    listFriendsMock.mockResolvedValue({ ok: true, data: [friend()] });
    acceptMock.mockResolvedValue({ ok: true, data: { id: 'incoming-1', status: 'accepted' } });
    rejectMock.mockResolvedValue({ ok: true, data: { id: 'incoming-1', status: 'rejected' } });
    cancelMock.mockResolvedValue({ ok: true, data: { id: 'outgoing-1', status: 'cancelled' } });
    removeMock.mockResolvedValue({ ok: true, data: { id: 'friendship-1', status: 'removed' } });
    resetLinkMock.mockResolvedValue({ ok: true, data: friendLink({ code: 'new-code' }) });
    disableLinkMock.mockResolvedValue({ ok: true, data: { count: 1 } });
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    delete (navigator as Partial<Navigator>).clipboard;
  });

  it('loads and renders the friend link, split request lists, and current friends', async () => {
    renderPage();
    await flushTicks();

    expect(getLinkMock).toHaveBeenCalledOnce();
    expect(listRequestsMock).toHaveBeenCalledOnce();
    expect(listFriendsMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Friend management');
    expect(container.textContent).toContain('https://kap.example/u/friend-code');
    expect(container.textContent).toContain('Incoming requests');
    expect(container.textContent).toContain('acct_incoming');
    expect(container.textContent).toContain('Outgoing requests');
    expect(container.textContent).toContain('acct_outgoing');
    expect(container.textContent).toContain('Current friends');
    expect(container.textContent).toContain('Rin');
    expect(findButton(container, 'Accept')).toBeTruthy();
    expect(findButton(container, 'Reject')).toBeTruthy();
    expect(findButton(container, 'Cancel request')).toBeTruthy();
    expect(findButton(container, 'Remove friend')).toBeTruthy();
    expect(container.textContent).toContain('Accepted');

    const terminalRow = [...container.querySelectorAll('.customer-friend-row')].find((row) =>
      row.textContent?.includes('acct_done'),
    );
    expect(terminalRow?.textContent).toContain('Accepted');
    expect(terminalRow?.querySelector('button')).toBeNull();
  });

  it('redirects auth failures on load to login with the friends next path', async () => {
    getLinkMock.mockResolvedValueOnce({ ok: false, error: 'claim_inactive' });

    renderPage();
    await flushTicks();

    expect(replaceMock).toHaveBeenCalledWith('/auth/login?next=/account/friends');
  });

  it('shows quiet empty states when request and friend lists are empty', async () => {
    listRequestsMock.mockResolvedValueOnce({ ok: true, data: [] });
    listFriendsMock.mockResolvedValueOnce({ ok: true, data: [] });

    renderPage();
    await flushTicks();

    expect(container.textContent).toContain('No incoming friend requests.');
    expect(container.textContent).toContain('No outgoing friend requests.');
    expect(container.textContent).toContain('No friends yet.');
  });

  it('refreshes all friend datasets after request and friend mutations', async () => {
    renderPage();
    await flushTicks();

    findButton(container, 'Accept')?.click();
    await flushTicks();
    expect(acceptMock).toHaveBeenCalledWith('incoming-1');
    expect(getLinkMock).toHaveBeenCalledTimes(2);
    expect(listRequestsMock).toHaveBeenCalledTimes(2);
    expect(listFriendsMock).toHaveBeenCalledTimes(2);

    findButton(container, 'Reject')?.click();
    await flushTicks();
    expect(rejectMock).toHaveBeenCalledWith('incoming-1');
    expect(getLinkMock).toHaveBeenCalledTimes(3);
    expect(listRequestsMock).toHaveBeenCalledTimes(3);
    expect(listFriendsMock).toHaveBeenCalledTimes(3);

    findButton(container, 'Cancel request')?.click();
    await flushTicks();
    expect(cancelMock).toHaveBeenCalledWith('outgoing-1');
    expect(getLinkMock).toHaveBeenCalledTimes(4);
    expect(listRequestsMock).toHaveBeenCalledTimes(4);
    expect(listFriendsMock).toHaveBeenCalledTimes(4);

    findButton(container, 'Remove friend')?.click();
    await flushTicks();
    expect(removeMock).toHaveBeenCalledWith('friendship-1');
    expect(getLinkMock).toHaveBeenCalledTimes(5);
    expect(listRequestsMock).toHaveBeenCalledTimes(5);
    expect(listFriendsMock).toHaveBeenCalledTimes(5);
  });

  it('copies and resets the current friend link', async () => {
    renderPage();
    await flushTicks();

    findButton(container, 'Copy link')?.click();
    await flushTicks();
    expect(writeTextMock).toHaveBeenCalledWith('https://kap.example/u/friend-code');
    expect(container.textContent).toContain('Link copied.');

    findButton(container, 'Reset link')?.click();
    await flushTicks();
    expect(resetLinkMock).toHaveBeenCalledOnce();
    expect(getLinkMock).toHaveBeenCalledTimes(2);
    expect(listRequestsMock).toHaveBeenCalledTimes(2);
    expect(listFriendsMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the disabled friend link local without immediately fetching a replacement link', async () => {
    getLinkMock
      .mockResolvedValueOnce({ ok: true, data: friendLink({ url: 'https://kap.example/u/abc' }) })
      .mockResolvedValue({ ok: true, data: friendLink({ url: 'https://kap.example/u/new-link' }) });

    renderPage();
    await flushTicks();
    expect(container.textContent).toContain('https://kap.example/u/abc');

    findButton(container, 'Disable current link')?.click();
    await flushTicks();

    expect(disableLinkMock).toHaveBeenCalledOnce();
    expect(getLinkMock).toHaveBeenCalledTimes(1);
    expect(listRequestsMock).toHaveBeenCalledTimes(1);
    expect(listFriendsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('The current link was disabled.');
    expect(container.textContent).not.toContain('https://kap.example/u/abc');
    expect(container.textContent).not.toContain('https://kap.example/u/new-link');
  });

  it('redirects auth failures from mutations and shows action failures without leaving the page', async () => {
    acceptMock.mockResolvedValueOnce({ ok: false, error: 'unauthorized' });

    renderPage();
    await flushTicks();
    findButton(container, 'Accept')?.click();
    await flushTicks();

    expect(replaceMock).toHaveBeenCalledWith('/auth/login?next=/account/friends');

    replaceMock.mockReset();
    rejectMock.mockResolvedValueOnce({ ok: false, error: 'upstream_unavailable' });
    findButton(container, 'Reject')?.click();
    await flushTicks();

    expect(replaceMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Unable to update friend data right now.');
  });
});
