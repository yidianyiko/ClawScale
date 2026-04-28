import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clearAdminSessionMock = vi.hoisted(() => vi.fn());
const getAdminTokenMock = vi.hoisted(() => vi.fn());

vi.mock('./admin-auth', () => ({
  clearAdminSession: () => clearAdminSessionMock(),
  getAdminToken: () => getAdminTokenMock(),
}));

import { adminApi } from './admin-api';

describe('adminApi session invalidation', () => {
  beforeEach(() => {
    clearAdminSessionMock.mockReset();
    getAdminTokenMock.mockReset();
    getAdminTokenMock.mockReturnValue('admin-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the admin session when a protected request returns account_not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 404,
        json: async () => ({
          ok: false,
          error: 'account_not_found',
        }),
      })) as unknown as typeof fetch,
    );

    await expect(adminApi.get('/api/admin/customers?limit=10&offset=0')).resolves.toEqual({
      ok: false,
      error: 'account_not_found',
    });

    expect(clearAdminSessionMock).toHaveBeenCalledTimes(1);
  });
});
