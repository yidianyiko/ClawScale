import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduling = vi.hoisted(() => ({
  getOrCreateActiveUserLink: vi.fn(),
  resetUserLink: vi.fn(),
  queryBookableWindows: vi.fn(),
  requestAppointment: vi.fn(),
  confirmAppointment: vi.fn(),
  rejectAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  listPendingRequests: vi.fn(),
  blockServiceLink: vi.fn(),
  unblockServiceLink: vi.fn(),
  removeServiceLink: vi.fn(),
  retryPendingSchedulingNotifications: vi.fn(),
}));

const db = vi.hoisted(() => ({
  serviceLink: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../scheduling/user-link-service.js', () => ({
  getOrCreateActiveUserLink: scheduling.getOrCreateActiveUserLink,
  resetUserLink: scheduling.resetUserLink,
}));
vi.mock('../scheduling/appointment-service.js', () => ({
  queryBookableWindows: scheduling.queryBookableWindows,
  requestAppointment: scheduling.requestAppointment,
  confirmAppointment: scheduling.confirmAppointment,
  rejectAppointment: scheduling.rejectAppointment,
  cancelAppointment: scheduling.cancelAppointment,
  listPendingRequests: scheduling.listPendingRequests,
}));
vi.mock('../scheduling/service-link-service.js', () => ({
  blockServiceLink: scheduling.blockServiceLink,
  unblockServiceLink: scheduling.unblockServiceLink,
  removeServiceLink: scheduling.removeServiceLink,
}));
vi.mock('../scheduling/notification-service.js', () => ({
  retryPendingSchedulingNotifications: scheduling.retryPendingSchedulingNotifications,
}));
vi.mock('../scheduling/time.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scheduling/time.js')>()),
  decodeWindowInstanceId: vi.fn(() => ({
    bookableWindowId: 'bw_1',
    instanceStart: '2026-05-22T01:00:00.000Z',
    instanceEnd: '2026-05-22T02:00:00.000Z',
  })),
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
    scheduling.requestAppointment.mockResolvedValue({ id: 'apt_1' });
    scheduling.retryPendingSchedulingNotifications.mockResolvedValue({ delivered: 1, failed: 0 });
  });

  it('requires the internal bearer token for tools', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/get_user_link', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expect(scheduling.getOrCreateActiveUserLink).not.toHaveBeenCalled();
  });

  it('dispatches scheduling tools with snake_case bridge inputs', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/request_appointment', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_provider',
        consumer_account_id: 'ck_consumer',
        bookable_window_id: 'bw_1',
        instance_start: '2026-05-22T01:00:00.000Z',
        instance_end: '2026-05-22T02:00:00.000Z',
        timezone: 'Asia/Tokyo',
        idempotency_key: 'idem_1',
      }),
    });

    expect(res.status).toBe(201);
    expect(scheduling.requestAppointment).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
      consumerAccountId: 'ck_consumer',
      bookableWindowId: 'bw_1',
      instanceStart: '2026-05-22T01:00:00.000Z',
      instanceEnd: '2026-05-22T02:00:00.000Z',
      timezone: 'Asia/Tokyo',
      idempotencyKey: 'idem_1',
    });
  });

  it('treats customer_id as consumer and target_account_id as provider for bookable queries', async () => {
    scheduling.queryBookableWindows.mockResolvedValueOnce([]);

    const res = await createApp().request('/api/internal/scheduling/tools/query_bookable_windows', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_consumer',
        target_account_id: 'ck_provider',
        date_from: '2026-05-22',
        date_to: '2026-05-23',
        viewer_timezone: 'Asia/Tokyo',
      }),
    });

    expect(res.status).toBe(200);
    expect(scheduling.queryBookableWindows).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
      consumerAccountId: 'ck_consumer',
      dateFrom: '2026-05-22',
      dateTo: '2026-05-23',
      viewerTimezone: 'Asia/Tokyo',
    });
  });

  it('accepts logical appointment request fields with a window instance id', async () => {
    const res = await createApp().request('/api/internal/scheduling/tools/request_appointment', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_consumer',
        target_account_id: 'ck_provider',
        window_instance_id: 'encoded-window-instance',
        timezone: 'Asia/Tokyo',
        idempotency_key: 'idem_1',
      }),
    });

    expect(res.status).toBe(201);
    expect(scheduling.requestAppointment).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
      consumerAccountId: 'ck_consumer',
      bookableWindowId: 'bw_1',
      instanceStart: '2026-05-22T01:00:00.000Z',
      instanceEnd: '2026-05-22T02:00:00.000Z',
      timezone: 'Asia/Tokyo',
      idempotencyKey: 'idem_1',
    });
  });

  it('reads renamed internal appointment fields and fails closed for retired service-link removal', async () => {
    scheduling.cancelAppointment.mockResolvedValueOnce({ id: 'apt_1', status: 'cancelled' });

    const cancelled = await createApp().request('/api/internal/scheduling/tools/cancel_appointment', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_consumer',
        appointment_or_request_id: 'apt_1',
        idempotency_key: 'cancel_1',
      }),
    });
    const removed = await createApp().request('/api/internal/scheduling/tools/remove_service_link', {
      method: 'POST',
      headers: {
        authorization: 'Bearer internal-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: 'ck_consumer',
        other_account_id: 'ck_provider',
      }),
    });

    expect(cancelled.status).toBe(200);
    expect(scheduling.cancelAppointment).toHaveBeenCalledWith(db as never, {
      actorAccountId: 'ck_consumer',
      requestId: 'apt_1',
      idempotencyKey: 'cancel_1',
    });
    await expect(removed.json()).resolves.toEqual({
      ok: false,
      error: 'appointment_scheduling_retired',
    });
    expect(removed.status).toBe(410);
    expect(db.serviceLink.findFirst).not.toHaveBeenCalled();
    expect(scheduling.removeServiceLink).not.toHaveBeenCalled();
  });

  it('protects notification retry with the same bearer token', async () => {
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
    expect(authorized.status).toBe(200);
    expect(scheduling.retryPendingSchedulingNotifications).toHaveBeenCalledWith(db as never, {
      limit: 5,
    });
  });
});
