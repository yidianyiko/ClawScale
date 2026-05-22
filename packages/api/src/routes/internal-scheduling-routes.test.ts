import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduling = vi.hoisted(() => ({
  getOrCreateActiveUserLink: vi.fn(),
  resetUserLink: vi.fn(),
}));

const db = vi.hoisted(() => ({}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../scheduling/user-link-service.js', () => ({
  getOrCreateActiveUserLink: scheduling.getOrCreateActiveUserLink,
  resetUserLink: scheduling.resetUserLink,
}));

import { internalSchedulingRouter } from './internal-scheduling-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/internal/scheduling', internalSchedulingRouter);
  return app;
}

describe('internal scheduling routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAWSCALE_IDENTITY_API_KEY = 'internal-key';
    scheduling.getOrCreateActiveUserLink.mockResolvedValue({ code: 'AbCdEfGhIjK_' });
  });

  it('requires the internal bearer token for tools', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/get_user_link', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expect(scheduling.getOrCreateActiveUserLink).not.toHaveBeenCalled();
  });

  it('keeps user-link tools active', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/get_user_link', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_provider',
      }),
    });

    expect(res.status).toBe(200);
    expect(scheduling.getOrCreateActiveUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
    });
  });

  it.each([
    'open_bookable_windows',
    'confirm_bookable_windows',
    'list_pending_requests',
    'query_bookable_windows',
    'request_appointment',
    'confirm_appointment',
    'reject_appointment',
    'cancel_appointment',
    'block_service_link',
    'unblock_service_link',
    'remove_service_link',
  ])('fails closed for retired tool %s', async (toolName) => {
    const res = await createApp().request(`/api/internal/scheduling/tools/${toolName}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_provider',
        preview: {},
      }),
    });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'appointment_scheduling_retired',
    });
  });

  it('fails closed for retired notification retry after auth', async () => {
    const unauthorized = await createApp().request('/api/internal/scheduling/notifications/retry', {
      method: 'POST',
    });
    const authorized = await createApp().request('/api/internal/scheduling/notifications/retry', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: 5 }),
    });

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(410);
    await expect(authorized.json()).resolves.toEqual({
      ok: false,
      error: 'appointment_scheduling_retired',
    });
  });
});
