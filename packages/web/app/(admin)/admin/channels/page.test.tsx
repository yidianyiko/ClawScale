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

import AdminChannelsPage from './page';

describe('AdminChannelsPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(adminApi.get).mockReset();
    vi.mocked(adminApi.get).mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: 'chn_123',
            name: 'Primary WhatsApp',
            kind: 'whatsapp',
            status: 'connected',
            ownershipKind: 'customer',
            customerId: 'cust_123',
            createdAt: '2026-04-16T09:00:00.000Z',
            updatedAt: '2026-04-16T10:00:00.000Z',
          },
        ],
        total: 12,
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

  it('renders channel filters and paging controls', async () => {
    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminChannelsPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(vi.mocked(adminApi.get)).toHaveBeenCalledWith('/api/admin/channels?limit=10&offset=0');
      expect(container.querySelector('select[name="status"]')).toBeTruthy();
      expect(container.querySelector('select[name="kind"]')).toBeTruthy();
      expect(container.textContent).toContain('Showing 1-1 of 12');
      expect(container.querySelector('button[aria-label="Previous page"]')).toBeTruthy();
      expect(container.querySelector('button[aria-label="Next page"]')).toBeTruthy();
    });
  });

  it('renders an explicit load failure with retry instead of the empty state', async () => {
    vi.mocked(adminApi.get)
      .mockResolvedValueOnce({
        ok: false,
        error: 'network_error',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [
            {
              id: 'chn_123',
              name: 'Primary WhatsApp',
              kind: 'whatsapp',
              status: 'connected',
              ownershipKind: 'customer',
              customerId: 'cust_123',
              createdAt: '2026-04-16T09:00:00.000Z',
              updatedAt: '2026-04-16T10:00:00.000Z',
            },
          ],
          total: 12,
          limit: 10,
          offset: 0,
        },
      });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <AdminChannelsPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Error: network_error');
      expect(container.querySelector('button[data-testid="retry-load"]')).toBeTruthy();
      expect(container.textContent).not.toContain('No records found.');
    });

    (container.querySelector('button[data-testid="retry-load"]') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(vi.mocked(adminApi.get)).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('Primary WhatsApp');
    });
  });
});
