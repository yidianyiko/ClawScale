import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../../components/locale-provider';
import { adminApi } from '../../../../../lib/admin-api';

const pushMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const paramsMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  useParams: () => paramsMock(),
}));

vi.mock('../../../../../lib/admin-api', () => ({
  adminApi: {
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import AdminSharedChannelDetailPage from './page';

describe('AdminSharedChannelDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const waitForEffects = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    paramsMock.mockReset();
    paramsMock.mockReturnValue({ id: 'ch_1' });
    vi.mocked(adminApi.get).mockReset();
    vi.mocked(adminApi.patch).mockReset();
    vi.mocked(adminApi.delete).mockReset();
    vi.mocked(adminApi.get).mockResolvedValue({
      ok: true,
      data: {
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
        config: {
          token: 'secret',
        },
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    });
    vi.mocked(adminApi.patch).mockResolvedValue({
      ok: true,
      data: {
        id: 'ch_1',
        name: 'Renamed WhatsApp',
        kind: 'whatsapp',
        status: 'connected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_2',
          slug: 'other',
          name: 'Other agent',
        },
        config: {
          token: 'updated',
        },
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T11:00:00.000Z',
      },
    });
    vi.mocked(adminApi.delete).mockResolvedValue({
      ok: true,
      data: null,
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('loads a shared channel and allows configuration and retirement', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminSharedChannelDetailPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(vi.mocked(adminApi.get)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1');
      expect(container.textContent).toContain('Primary WhatsApp');
      expect(container.textContent).toContain('Connected');
    });

    const nameInput = container.querySelector('#shared-channel-detail-name') as HTMLInputElement;
    const agentInput = container.querySelector('#shared-channel-detail-agent-id') as HTMLInputElement;
    const configInput = container.querySelector('#shared-channel-detail-config') as HTMLTextAreaElement;
    nameInput.value = 'Renamed WhatsApp';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    agentInput.value = 'agent_2';
    agentInput.dispatchEvent(new Event('input', { bubbles: true }));
    configInput.value = '{"token":"updated"}';
    configInput.dispatchEvent(new Event('input', { bubbles: true }));

    (container.querySelector('button[data-testid="save-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.patch)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1', {
      name: 'Renamed WhatsApp',
      agentId: 'agent_2',
      config: {
        token: 'updated',
      },
    });

    (container.querySelector('button[data-testid="retire-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.delete)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1');
    expect(pushMock).toHaveBeenCalledWith('/admin/shared-channels');
  });
});
