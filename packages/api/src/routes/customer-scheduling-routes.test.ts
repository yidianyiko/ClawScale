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
}));

const db = vi.hoisted(() => ({}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/customer-auth.js', () => auth);
vi.mock('../scheduling/user-link-service.js', () => ({
  getOrCreateActiveUserLink: scheduling.getOrCreateActiveUserLink,
  resetUserLink: scheduling.resetUserLink,
  disableUserLink: scheduling.disableUserLink,
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

  it.each([
    ['POST', '/bookable-windows/preview'],
    ['POST', '/bookable-windows/confirm'],
    ['GET', '/bookable-windows'],
    ['POST', '/appointments'],
    ['GET', '/appointments/pending'],
    ['POST', '/appointments/apt_1/confirm'],
    ['POST', '/appointments/apt_1/reject'],
    ['POST', '/appointments/apt_1/cancel'],
    ['POST', '/service-links/ck_other/block'],
    ['POST', '/service-links/ck_other/unblock'],
    ['DELETE', '/service-links/ck_other'],
  ])('fails closed for retired %s %s', async (method, path) => {
    const res = await createApp().request(`/api/customer/scheduling${path}`, {
      method,
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify({ preview: {}, idempotencyKey: 'idem_1' }),
    });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'appointment_scheduling_retired',
    });
  });
});
