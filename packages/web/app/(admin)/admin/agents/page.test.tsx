import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider } from '../../../../components/locale-provider';
import { adminApi } from '../../../../lib/admin-api';

vi.mock('../../../../lib/admin-api', () => ({
  adminApi: {
    get: vi.fn(),
  },
}));

import AdminAgentsPage from './page';

describe('AdminAgentsPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(adminApi.get).mockReset();
    vi.mocked(adminApi.get).mockResolvedValue({
      ok: true,
      data: {
        id: 'agent_coke',
        slug: 'coke',
        name: 'Coke',
        endpoint: 'https://agent.example.com',
        tokenConfigured: true,
        isDefault: true,
        lastHandshakeHealth: {
          status: 'unknown',
          source: 'unavailable',
          observedAt: null,
        },
        createdAt: '2026-04-16T09:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
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

  it('renders the Coke agent as a read-only operational record', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminAgentsPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(vi.mocked(adminApi.get)).toHaveBeenCalledWith('/api/admin/agents');
      expect(container.textContent).toContain('Read-only');
      expect(container.textContent).toContain('https://agent.example.com');
      expect(container.textContent).toContain('Health source');
      expect(container.querySelector('form')).toBeNull();
      expect(container.querySelector('button[type="submit"]')).toBeNull();
    });
  });
});
