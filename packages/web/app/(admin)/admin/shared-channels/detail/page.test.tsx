import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../../components/locale-provider';
import { adminApi } from '../../../../../lib/admin-api';

const pushMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const searchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  useSearchParams: () => searchParamsMock(),
}));

vi.mock('../../../../../lib/admin-api', () => ({
  adminApi: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
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
    searchParamsMock.mockReset();
    searchParamsMock.mockReturnValue(new URLSearchParams('id=ch_1'));
    vi.mocked(adminApi.get).mockReset();
    vi.mocked(adminApi.patch).mockReset();
    vi.mocked(adminApi.post).mockReset();
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

  it('loads a shared channel and allows configuration and retirement from the static detail page', async () => {
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

  it('shows typed whatsapp_evolution config, connect/disconnect actions, and hidden token semantics', async () => {
    vi.mocked(adminApi.get).mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'ch_1',
        name: 'Evolution WhatsApp',
        kind: 'whatsapp_evolution',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          instanceName: 'coke-whatsapp-personal',
          webhookToken: 'secret-token',
        },
        hasWebhookToken: true,
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    });
    vi.mocked(adminApi.patch)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'ch_1',
          name: 'Evolution WhatsApp',
          kind: 'whatsapp_evolution',
          status: 'disconnected',
          ownershipKind: 'shared',
          customerId: null,
          agent: {
            id: 'agent_coke',
            slug: 'coke',
            name: 'Coke',
          },
          config: {
            instanceName: 'coke-whatsapp-personal-v2',
            webhookToken: 'secret-token',
          },
          hasWebhookToken: true,
          createdAt: '2026-04-16T09:00:00.000Z',
          updatedAt: '2026-04-16T10:30:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'ch_1',
          name: 'Evolution WhatsApp Connected',
          kind: 'whatsapp_evolution',
          status: 'connected',
          ownershipKind: 'shared',
          customerId: null,
          agent: {
            id: 'agent_connected',
            slug: 'connected',
            name: 'Connected Agent',
          },
          config: {
            instanceName: 'coke-whatsapp-personal-v2',
            webhookToken: 'secret-token',
          },
          hasWebhookToken: true,
          createdAt: '2026-04-16T09:00:00.000Z',
          updatedAt: '2026-04-16T11:10:00.000Z',
        },
      });
    vi.mocked(adminApi.post)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'ch_1',
          name: 'Evolution WhatsApp',
          kind: 'whatsapp_evolution',
          status: 'connected',
          ownershipKind: 'shared',
          customerId: null,
          agent: {
            id: 'agent_coke',
            slug: 'coke',
            name: 'Coke',
          },
          config: {
            instanceName: 'coke-whatsapp-personal-v2',
            webhookToken: 'secret-token',
          },
          hasWebhookToken: true,
          createdAt: '2026-04-16T09:00:00.000Z',
          updatedAt: '2026-04-16T11:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'ch_1',
          name: 'Evolution WhatsApp',
          kind: 'whatsapp_evolution',
          status: 'disconnected',
          ownershipKind: 'shared',
          customerId: null,
          agent: {
            id: 'agent_coke',
            slug: 'coke',
            name: 'Coke',
          },
          config: {
            instanceName: 'coke-whatsapp-personal-v2',
            webhookToken: 'secret-token',
          },
          hasWebhookToken: true,
          createdAt: '2026-04-16T09:00:00.000Z',
          updatedAt: '2026-04-16T11:30:00.000Z',
        },
      });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminSharedChannelDetailPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(vi.mocked(adminApi.get)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1');
      expect(container.textContent).toContain('Evolution WhatsApp');
      expect(container.textContent).toContain('Webhook token');
      expect(container.textContent).toContain('Hidden and managed server-side.');
      expect(container.querySelector('#shared-channel-detail-instance-name')).toBeTruthy();
      expect(container.querySelector('#shared-channel-detail-config')).toBeNull();
      expect(container.querySelector('button[data-testid="connect-shared-channel"]')).toBeTruthy();
    });

    const instanceNameInput = container.querySelector('#shared-channel-detail-instance-name') as HTMLInputElement;
    const nameInput = container.querySelector('#shared-channel-detail-name') as HTMLInputElement;
    const agentInput = container.querySelector('#shared-channel-detail-agent-id') as HTMLInputElement;
    instanceNameInput.value = 'coke-whatsapp-personal-v2';
    instanceNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.value = 'Evolution WhatsApp';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    agentInput.value = 'agent_coke';
    agentInput.dispatchEvent(new Event('input', { bubbles: true }));

    (container.querySelector('button[data-testid="save-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.patch)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1', {
      name: 'Evolution WhatsApp',
      agentId: 'agent_coke',
      config: {
        instanceName: 'coke-whatsapp-personal-v2',
      },
    });

    (container.querySelector('button[data-testid="connect-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.post)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1/connect');
    await vi.waitFor(() => {
      expect(container.querySelector('button[data-testid="disconnect-shared-channel"]')).toBeTruthy();
    });

    const connectedNameInput = container.querySelector('#shared-channel-detail-name') as HTMLInputElement;
    const connectedAgentInput = container.querySelector('#shared-channel-detail-agent-id') as HTMLInputElement;
    connectedNameInput.value = 'Evolution WhatsApp Connected';
    connectedNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    connectedAgentInput.value = 'agent_connected';
    connectedAgentInput.dispatchEvent(new Event('input', { bubbles: true }));

    (container.querySelector('button[data-testid="save-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.patch)).toHaveBeenNthCalledWith(2, '/api/admin/shared-channels/ch_1', {
      name: 'Evolution WhatsApp Connected',
      agentId: 'agent_connected',
      config: {
        instanceName: 'coke-whatsapp-personal-v2',
      },
    });

    (container.querySelector('button[data-testid="disconnect-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.post)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1/disconnect');
    expect(container.textContent).toContain('Disconnected');
  });

  it('shows wechat_ecloud public config and local connect controls without Evolution fields', async () => {
    vi.mocked(adminApi.get).mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'ch_1',
        name: 'Ecloud WeChat',
        kind: 'wechat_ecloud',
        status: 'disconnected',
        ownershipKind: 'shared',
        customerId: null,
        agent: {
          id: 'agent_coke',
          slug: 'coke',
          name: 'Coke',
        },
        config: {
          appId: 'app_1',
          baseUrl: 'https://api.geweapi.com',
          callbackPath: '/gateway/ecloud/wechat/:channelId/:token',
        },
        hasWebhookToken: true,
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    });
    vi.mocked(adminApi.post)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'ch_1',
          name: 'Ecloud WeChat',
          kind: 'wechat_ecloud',
          status: 'connected',
          ownershipKind: 'shared',
          customerId: null,
          agent: {
            id: 'agent_coke',
            slug: 'coke',
            name: 'Coke',
          },
          config: {
            appId: 'app_1',
            baseUrl: 'https://api.geweapi.com',
            callbackPath: '/gateway/ecloud/wechat/:channelId/:token',
          },
          hasWebhookToken: true,
          createdAt: '2026-04-16T09:00:00.000Z',
          updatedAt: '2026-04-16T11:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'ch_1',
          name: 'Ecloud WeChat',
          kind: 'wechat_ecloud',
          status: 'disconnected',
          ownershipKind: 'shared',
          customerId: null,
          agent: {
            id: 'agent_coke',
            slug: 'coke',
            name: 'Coke',
          },
          config: {
            appId: 'app_1',
            baseUrl: 'https://api.geweapi.com',
            callbackPath: '/gateway/ecloud/wechat/:channelId/:token',
          },
          hasWebhookToken: true,
          createdAt: '2026-04-16T09:00:00.000Z',
          updatedAt: '2026-04-16T11:30:00.000Z',
        },
      });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminSharedChannelDetailPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Ecloud WeChat');
      expect(container.textContent).toContain('/gateway/ecloud/wechat/:channelId/:token');
      expect(container.textContent).toContain('Hidden and managed server-side.');
      expect((container.querySelector('#shared-channel-detail-ecloud-app-id') as HTMLInputElement).value).toBe('app_1');
      expect((container.querySelector('#shared-channel-detail-ecloud-base-url') as HTMLInputElement).value).toBe('https://api.geweapi.com');
      expect(container.querySelector('#shared-channel-detail-instance-name')).toBeNull();
      expect(container.querySelector('#shared-channel-detail-config')).toBeNull();
      expect(container.querySelector('button[data-testid="connect-shared-channel"]')).toBeTruthy();
    });

    (container.querySelector('button[data-testid="connect-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.post)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1/connect');
    await vi.waitFor(() => {
      expect(container.querySelector('button[data-testid="disconnect-shared-channel"]')).toBeTruthy();
      expect(container.textContent).toContain('Connected');
    });

    (container.querySelector('button[data-testid="disconnect-shared-channel"]') as HTMLButtonElement).click();
    await waitForEffects();

    expect(vi.mocked(adminApi.post)).toHaveBeenCalledWith('/api/admin/shared-channels/ch_1/disconnect');
    expect(container.textContent).toContain('Disconnected');
  });
});
