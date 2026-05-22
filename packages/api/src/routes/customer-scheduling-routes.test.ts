import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  getCustomerSession: vi.fn(),
}));

const scheduling = vi.hoisted(() => ({
  getOrCreateActiveUserLink: vi.fn(),
  resetUserLink: vi.fn(),
  disableUserLink: vi.fn(),
  previewBookableWindows: vi.fn(),
  confirmBookableWindowPreview: vi.fn(),
  requestAppointment: vi.fn(),
  listPendingRequests: vi.fn(),
  confirmAppointment: vi.fn(),
  rejectAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  blockServiceLink: vi.fn(),
  unblockServiceLink: vi.fn(),
  removeServiceLink: vi.fn(),
}));

const db = vi.hoisted(() => ({
  bookableWindow: {
    findMany: vi.fn(),
  },
  serviceLink: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/customer-auth.js', () => auth);
vi.mock('../scheduling/user-link-service.js', () => ({
  getOrCreateActiveUserLink: scheduling.getOrCreateActiveUserLink,
  resetUserLink: scheduling.resetUserLink,
  disableUserLink: scheduling.disableUserLink,
}));
vi.mock('../scheduling/availability-service.js', () => ({
  previewBookableWindows: scheduling.previewBookableWindows,
  confirmBookableWindowPreview: scheduling.confirmBookableWindowPreview,
}));
vi.mock('../scheduling/appointment-service.js', () => ({
  requestAppointment: scheduling.requestAppointment,
  listPendingRequests: scheduling.listPendingRequests,
  confirmAppointment: scheduling.confirmAppointment,
  rejectAppointment: scheduling.rejectAppointment,
  cancelAppointment: scheduling.cancelAppointment,
}));
vi.mock('../scheduling/service-link-service.js', () => ({
  blockServiceLink: scheduling.blockServiceLink,
  unblockServiceLink: scheduling.unblockServiceLink,
  removeServiceLink: scheduling.removeServiceLink,
}));

import { customerSchedulingRouter } from './customer-scheduling-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/customer/scheduling', customerSchedulingRouter);
  return app;
}

describe('customer scheduling routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyCustomerToken.mockReturnValue({
      sub: 'ck_123',
      identityId: 'idt_123',
      tokenType: 'access',
    });
    auth.getCustomerSession.mockResolvedValue({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
    scheduling.getOrCreateActiveUserLink.mockResolvedValue({
      code: 'AbCdEfGhIjK_',
      status: 'active',
    });
    scheduling.requestAppointment.mockResolvedValue({ id: 'apt_1' });
    scheduling.confirmAppointment.mockResolvedValue({ id: 'apt_1', status: 'confirmed_shared' });
    scheduling.blockServiceLink.mockResolvedValue({ id: 'sl_1', status: 'blocked' });
  });

  it('requires customer auth before returning a user link', async () => {
    const res = await createApp().request('/api/customer/scheduling/user-link');

    expect(res.status).toBe(401);
    expect(auth.verifyCustomerToken).not.toHaveBeenCalled();
    expect(scheduling.getOrCreateActiveUserLink).not.toHaveBeenCalled();
  });

  it('uses the authenticated customer id for user-link ownership', async () => {
    const res = await createApp().request('/api/customer/scheduling/user-link', {
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(auth.verifyCustomerToken).toHaveBeenCalledWith('customer-token');
    expect(scheduling.getOrCreateActiveUserLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_123',
    });
  });

  it('uses the authenticated customer as appointment consumer and ignores caller consumer ids', async () => {
    const res = await createApp().request('/api/customer/scheduling/appointments', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        providerAccountId: 'ck_provider',
        consumerAccountId: 'ck_attacker',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-05-22T01:00:00.000Z',
        instanceEnd: '2026-05-22T02:00:00.000Z',
        timezone: 'Asia/Tokyo',
        idempotencyKey: 'idem_1',
      }),
    });

    expect(res.status).toBe(201);
    expect(scheduling.requestAppointment).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_provider',
      consumerAccountId: 'ck_123',
      bookableWindowId: 'bw_1',
      instanceStart: '2026-05-22T01:00:00.000Z',
      instanceEnd: '2026-05-22T02:00:00.000Z',
      timezone: 'Asia/Tokyo',
      idempotencyKey: 'idem_1',
    });
  });

  it('uses the authenticated customer as provider actor for provider appointment actions', async () => {
    const res = await createApp().request('/api/customer/scheduling/appointments/apt_1/confirm', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ actorAccountId: 'ck_attacker', idempotencyKey: 'confirm_1' }),
    });

    expect(res.status).toBe(200);
    expect(scheduling.confirmAppointment).toHaveBeenCalledWith(db as never, {
      actorAccountId: 'ck_123',
      requestId: 'apt_1',
      idempotencyKey: 'confirm_1',
    });
  });

  it('uses the authenticated customer as service-link provider', async () => {
    const res = await createApp().request('/api/customer/scheduling/service-links/ck_other/block', {
      method: 'POST',
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(200);
    expect(scheduling.blockServiceLink).toHaveBeenCalledWith(db as never, {
      providerAccountId: 'ck_123',
      consumerAccountId: 'ck_other',
    });
  });

  it('fails closed for retired service-link deletion', async () => {
    const res = await createApp().request('/api/customer/scheduling/service-links/ck_provider', {
      method: 'DELETE',
      headers: { authorization: 'Bearer customer-token' },
    });

    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'appointment_scheduling_retired',
    });
    expect(res.status).toBe(410);
    expect(db.serviceLink.findFirst).not.toHaveBeenCalled();
    expect(scheduling.removeServiceLink).not.toHaveBeenCalled();
  });
});
