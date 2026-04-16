import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

const apiGetMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('api.get should not be called');
}));
const apiDeleteMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('api.delete should not be called');
}));
const apiPatchMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('api.patch should not be called');
}));
const apiPostMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('api.post should not be called');
}));
const getUserMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('getUser should not be called');
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    delete: (...args: unknown[]) => apiDeleteMock(...args),
    patch: (...args: unknown[]) => apiPatchMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    delete: (...args: unknown[]) => apiDeleteMock(...args),
    patch: (...args: unknown[]) => apiPatchMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

vi.mock('../../lib/auth', () => ({
  getUser: () => getUserMock(),
}));

vi.mock('@/lib/auth', () => ({
  getUser: () => getUserMock(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/locale-provider', async () => {
  const actual = await vi.importActual<typeof import('../../components/locale-provider')>('../../components/locale-provider');
  return actual;
});

import ConversationsPage from './conversations/page';
import AiBackendsPage from './ai-backends/page';
import WorkflowsPage from './workflows/page';

describe('retired dashboard pages', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    apiGetMock.mockClear();
    apiDeleteMock.mockClear();
    apiPatchMock.mockClear();
    apiPostMock.mockClear();
    getUserMock.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders the conversations retirement notice without touching removed APIs', async () => {
    flushSync(() => {
      root.render(<ConversationsPage />);
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Conversations moved');
      expect(container.textContent).toContain('Conversation history is no longer available in the gateway dashboard.');
      expect(container.textContent).toContain('Use the customer-facing Coke surfaces for live conversation review.');
    });

    expect(apiGetMock).not.toHaveBeenCalled();
    expect(apiDeleteMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('renders the AI backends retirement notice without touching removed APIs', async () => {
    flushSync(() => {
      root.render(<AiBackendsPage />);
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('AI backends moved');
      expect(container.textContent).toContain('Backend selection no longer happens in this dashboard.');
      expect(container.textContent).toContain('Routing now uses the active delivery configuration instead of dashboard-managed backends.');
    });

    expect(apiGetMock).not.toHaveBeenCalled();
    expect(apiDeleteMock).not.toHaveBeenCalled();
    expect(apiPatchMock).not.toHaveBeenCalled();
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('renders the workflows retirement notice without touching removed APIs', async () => {
    flushSync(() => {
      root.render(<WorkflowsPage />);
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Workflows retired');
      expect(container.textContent).toContain('Gateway-managed workflow automation has been removed.');
      expect(container.textContent).toContain('Use channel routing and downstream automation tools for new delivery flows.');
    });

    expect(apiGetMock).not.toHaveBeenCalled();
    expect(apiDeleteMock).not.toHaveBeenCalled();
    expect(apiPatchMock).not.toHaveBeenCalled();
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
  });
});
