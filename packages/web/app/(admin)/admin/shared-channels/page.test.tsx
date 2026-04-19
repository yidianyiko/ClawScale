import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../components/locale-provider';
import { adminApi } from '../../../../lib/admin-api';

const pushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('../../../../lib/admin-api', () => ({
  adminApi: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import AdminSharedChannelsPage from './page';

describe('AdminSharedChannelsPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const waitForEffects = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(adminApi.get).mockReset();
    vi.mocked(adminApi.post).mockReset();
    vi.mocked(adminApi.get).mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: 'ch_1',
            name: 'Primary WhatsApp',
            kind: 'whatsapp',
            status: 'connected',
            ownershipKind: 'shared',
            customerId: null,
            agent: {
              id: 'agent_coke',
              slug: 'coke',
              name: 'Coke',
            },
            createdAt: '2026-04-16T09:00:00.000Z',
            updatedAt: '2026-04-16T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      },
    });
    vi.mocked(adminApi.post).mockResolvedValue({
      ok: true,
      data: {
        id: 'ch_new',
        name: 'New Shared Channel',
        kind: 'whatsapp',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          token: 'secret',
        },
        createdAt: '2026-04-16T11:00:00.000Z',
        updatedAt: '2026-04-16T11:00:00.000Z',
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders shared channels and routes detail navigation through the static-export-safe detail page', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminSharedChannelsPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(vi.mocked(adminApi.get)).toHaveBeenCalledWith('/api/admin/shared-channels?limit=50&offset=0');
      expect(container.textContent).toContain('Shared channels');
      expect(container.textContent).toContain('Primary WhatsApp');
      expect(container.querySelector('a[href="/admin/shared-channels/detail?id=ch_1"]')).toBeTruthy();
    });

    (container.querySelector('button[data-testid="open-create-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    const nameInput = container.querySelector('#shared-channel-name') as HTMLInputElement;
    const kindInput = container.querySelector('#shared-channel-kind') as HTMLSelectElement;
    const agentInput = container.querySelector('#shared-channel-agent-id') as HTMLInputElement;
    const configInput = container.querySelector('#shared-channel-config') as HTMLTextAreaElement;
    nameInput.value = 'New Shared Channel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    kindInput.value = 'whatsapp';
    kindInput.dispatchEvent(new Event('change', { bubbles: true }));
    agentInput.value = 'agent_coke';
    agentInput.dispatchEvent(new Event('input', { bubbles: true }));
    configInput.value = '{"token":"secret"}';
    configInput.dispatchEvent(new Event('input', { bubbles: true }));

    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitForEffects();

    expect(vi.mocked(adminApi.post)).toHaveBeenCalledWith('/api/admin/shared-channels', {
      name: 'New Shared Channel',
      kind: 'whatsapp',
      agentId: 'agent_coke',
      config: {
        token: 'secret',
      },
    });
    expect(pushMock).toHaveBeenCalledWith('/admin/shared-channels/detail?id=ch_new');
  });
});
