import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../lib/clawscale-user.js', () => ({
  ensureClawscaleUserForCokeAccount: vi.fn(),
}));

import { ensureClawscaleUserForCokeAccount } from '../lib/clawscale-user.js';
import { cokeUserProvisionRouter } from './coke-user-provision.js';

describe('coke-user-provision router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAWSCALE_IDENTITY_API_KEY = 'secret';
  });

  it('rejects invalid bearer tokens', async () => {
    const app = new Hono();
    app.route('/api/internal/coke-users/provision', cokeUserProvisionRouter);

    const res = await app.request('/api/internal/coke-users/provision', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: JSON.stringify({
        coke_account_id: 'acct_1',
        display_name: 'Alice',
      }),
    });

    expect(res.status).toBe(401);
    expect(ensureClawscaleUserForCokeAccount).not.toHaveBeenCalled();
  });

  it('returns the expected success payload', async () => {
    vi.mocked(ensureClawscaleUserForCokeAccount).mockResolvedValue({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
      created: true,
    });

    const app = new Hono();
    app.route('/api/internal/coke-users/provision', cokeUserProvisionRouter);

    const res = await app.request('/api/internal/coke-users/provision', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        coke_account_id: 'acct_1',
        display_name: 'Alice',
      }),
    });

    expect(res.status).toBe(200);
    expect(ensureClawscaleUserForCokeAccount).toHaveBeenCalledWith({
      cokeAccountId: 'acct_1',
      displayName: 'Alice',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        tenant_id: 'ten_1',
        clawscale_user_id: 'csu_1',
      },
    });
  });

  it('returns 400 for malformed request bodies and does not call the helper', async () => {
    const app = new Hono();
    app.route('/api/internal/coke-users/provision', cokeUserProvisionRouter);

    const res = await app.request('/api/internal/coke-users/provision', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: '{',
    });

    expect(res.status).toBe(400);
    expect(ensureClawscaleUserForCokeAccount).not.toHaveBeenCalled();
  });
});
