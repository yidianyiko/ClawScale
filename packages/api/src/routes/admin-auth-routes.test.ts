import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  adminAccount: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

import { hashAdminPassword } from '../lib/admin-auth.js';
import { signCustomerToken } from '../lib/customer-auth.js';
import { adminAuthRouter } from './admin-auth-routes.js';

describe('admin auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_JWT_SECRET = 'admin-secret';
    process.env.CUSTOMER_JWT_SECRET = 'customer-secret';
  });

  it('logs in with an AdminAccount and returns the current admin session', async () => {
    const passwordHash = await hashAdminPassword('password123');
    db.adminAccount.findUnique.mockResolvedValue({
      id: 'adm_123',
      email: 'admin@example.com',
      passwordHash,
      isActive: true,
      createdAt: new Date('2026-04-16T00:00:00.000Z'),
      updatedAt: new Date('2026-04-16T00:00:00.000Z'),
    });

    const app = new Hono();
    app.route('/api/admin', adminAuthRouter);

    const loginRes = await app.request('/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'Admin@Example.com',
        password: 'password123',
      }),
    });

    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody).toEqual({
      ok: true,
      data: {
        adminId: 'adm_123',
        email: 'admin@example.com',
        isActive: true,
        token: expect.any(String),
      },
    });

    const sessionRes = await app.request('/api/admin/session', {
      headers: {
        Authorization: `Bearer ${loginBody.data.token}`,
      },
    });

    expect(sessionRes.status).toBe(200);
    await expect(sessionRes.json()).resolves.toEqual({
      ok: true,
      data: {
        adminId: 'adm_123',
        email: 'admin@example.com',
        isActive: true,
      },
    });
  });

  it('keeps admin session handling independent from customer auth', async () => {
    const customerToken = signCustomerToken({
      customerId: 'ck_123',
      identityId: 'idt_123',
      email: 'alice@example.com',
    });

    const app = new Hono();
    app.route('/api/admin', adminAuthRouter);

    const res = await app.request('/api/admin/session', {
      headers: {
        Authorization: `Bearer ${customerToken}`,
      },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'invalid_or_expired_token',
    });
  });

  it('rejects login for inactive admins', async () => {
    const passwordHash = await hashAdminPassword('password123');
    db.adminAccount.findUnique.mockResolvedValue({
      id: 'adm_123',
      email: 'admin@example.com',
      passwordHash,
      isActive: false,
    });

    const app = new Hono();
    app.route('/api/admin', adminAuthRouter);

    const res = await app.request('/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'inactive_account',
    });
  });
});
