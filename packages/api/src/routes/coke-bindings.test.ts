import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  endUser: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  clawscaleUser: {
    upsert: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/clawscale-user.js', () => ({
  bindEndUserToCokeAccount: vi.fn(),
}));

import { bindEndUserToCokeAccount } from '../lib/clawscale-user.js';
import { cokeBindingsRouter } from './coke-bindings.js';

describe('coke-bindings router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAWSCALE_IDENTITY_API_KEY = 'secret';
  });

  it('rejects invalid bearer tokens', async () => {
    const app = new Hono();
    app.route('/api/internal/coke-bindings', cokeBindingsRouter);

    const res = await app.request('/api/internal/coke-bindings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        channel_id: 'ch_1',
        external_id: 'ext_1',
        coke_account_id: 'acct_1',
      }),
    });

    expect(res.status).toBe(401);
  });

  it('returns the expected success payload', async () => {
    vi.mocked(bindEndUserToCokeAccount).mockResolvedValue({
      clawscaleUserId: 'csu_1',
      endUserId: 'eu_1',
      cokeAccountId: 'acct_1',
    });

    const app = new Hono();
    app.route('/api/internal/coke-bindings', cokeBindingsRouter);

    const res = await app.request('/api/internal/coke-bindings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        channel_id: 'ch_1',
        external_id: 'ext_1',
        coke_account_id: 'acct_1',
      }),
    });

    expect(res.status).toBe(200);
    expect(bindEndUserToCokeAccount).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'ext_1',
      cokeAccountId: 'acct_1',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        clawscale_user_id: 'csu_1',
        end_user_id: 'eu_1',
        coke_account_id: 'acct_1',
      },
    });
  });

  it('accepts customer_id as a compatibility alias', async () => {
    vi.mocked(bindEndUserToCokeAccount).mockResolvedValue({
      clawscaleUserId: 'csu_1',
      endUserId: 'eu_1',
      cokeAccountId: 'acct_customer_1',
    });

    const app = new Hono();
    app.route('/api/internal/coke-bindings', cokeBindingsRouter);

    const res = await app.request('/api/internal/coke-bindings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        channel_id: 'ch_1',
        external_id: 'ext_1',
        customer_id: 'acct_customer_1',
      }),
    });

    expect(res.status).toBe(200);
    expect(bindEndUserToCokeAccount).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'ext_1',
      cokeAccountId: 'acct_customer_1',
    });
  });

  it('returns 404 when the end user does not exist', async () => {
    vi.mocked(bindEndUserToCokeAccount).mockRejectedValue({ code: 'end_user_not_found' });

    const app = new Hono();
    app.route('/api/internal/coke-bindings', cokeBindingsRouter);

    const res = await app.request('/api/internal/coke-bindings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        channel_id: 'ch_1',
        external_id: 'ext_1',
        coke_account_id: 'acct_1',
      }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the end user is already bound to another ClawscaleUser', async () => {
    vi.mocked(bindEndUserToCokeAccount).mockRejectedValue({ code: 'end_user_already_bound' });

    const app = new Hono();
    app.route('/api/internal/coke-bindings', cokeBindingsRouter);

    const res = await app.request('/api/internal/coke-bindings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        channel_id: 'ch_1',
        external_id: 'ext_1',
        coke_account_id: 'acct_1',
      }),
    });

    expect(res.status).toBe(409);
  });

  it('returns 400 for malformed request bodies and does not call the helper', async () => {
    const app = new Hono();
    app.route('/api/internal/coke-bindings', cokeBindingsRouter);

    const res = await app.request('/api/internal/coke-bindings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: '{',
    });

    expect(res.status).toBe(400);
    expect(bindEndUserToCokeAccount).not.toHaveBeenCalled();
  });
});
