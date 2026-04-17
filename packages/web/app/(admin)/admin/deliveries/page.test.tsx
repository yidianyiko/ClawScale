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

import AdminDeliveriesPage from './page';

describe('AdminDeliveriesPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(adminApi.get).mockReset();
    vi.mocked(adminApi.get).mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: 'del_123',
            tenantId: 'tenant_123',
            channelId: 'chn_123',
            idempotencyKey: 'idem_123',
            status: 'failed',
            error: 'remote_error',
            createdAt: '2026-04-16T09:00:00.000Z',
            updatedAt: '2026-04-16T10:00:00.000Z',
          },
        ],
        total: 6,
        limit: 10,
        offset: 0,
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

  it('renders delivery filters and paging controls', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminDeliveriesPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(vi.mocked(adminApi.get)).toHaveBeenCalledWith('/api/admin/deliveries?limit=10&offset=0');
      expect(container.querySelector('input[name="channelId"]')).toBeTruthy();
      expect(container.textContent).toContain('Failed deliveries');
      expect(container.textContent).toContain('Showing 1-1 of 6');
      expect(container.querySelector('button[aria-label="Previous page"]')).toBeTruthy();
      expect(container.querySelector('button[aria-label="Next page"]')).toBeTruthy();
    });
  });
});
