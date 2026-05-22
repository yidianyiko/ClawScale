import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

const mockSendFriendRequest = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/user-link-api', () => ({
  sendFriendRequest: mockSendFriendRequest,
}));

import { ClaimHandoff } from './claim-handoff';

describe('ClaimHandoff', () => {
  let container: HTMLDivElement;
  let root: Root;

  async function flushTicks(count: number) {
    for (let i = 0; i < count; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  beforeEach(() => {
    mockSendFriendRequest.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
  });

  it('returns to a retryable error state when friend-request submission rejects', async () => {
    mockSendFriendRequest.mockRejectedValueOnce(new Error('network down'));

    flushSync(() => {
      root.render(<ClaimHandoff token="session-token" targetName="Coach A" />);
    });

    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushTicks(3);

    const button = container.querySelector('button');
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toBe('Send friend request');
    expect(container.textContent).toContain('Friend request could not be sent. Please try again.');
  });
});
