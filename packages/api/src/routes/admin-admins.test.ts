import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  adminAccount: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (c: any, next: any) => {
    c.set('adminAuth', {
      adminId: 'adm_123',
      email: 'owner@example.com',
      isActive: true,
    });
    await next();
  },
}));

import { adminAdminsRouter } from './admin-admins.js';

describe('admin admins route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists, adds, and removes AdminAccount rows', async () => {
    db.adminAccount.findMany.mockResolvedValue([
      {
        id: 'adm_123',
        email: 'owner@example.com',
        isActive: true,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-04-01T10:00:00.000Z'),
      },
    ]);
    db.adminAccount.create.mockResolvedValue({
      id: 'adm_456',
      email: 'new-admin@example.com',
      isActive: true,
      createdAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    db.adminAccount.delete.mockResolvedValue({
      id: 'adm_456',
    });

    const app = new Hono();
    app.route('/api/admin/admins', adminAdminsRouter);

    const listRes = await app.request('/api/admin/admins');
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toEqual({
      ok: true,
      data: [
        {
          id: 'adm_123',
          email: 'owner@example.com',
          isActive: true,
          createdAt: '2026-04-01T10:00:00.000Z',
          updatedAt: '2026-04-01T10:00:00.000Z',
        },
      ],
    });

    const createRes = await app.request('/api/admin/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'New-Admin@Example.com',
        password: 'password123',
      }),
    });
    expect(createRes.status).toBe(201);
    await expect(createRes.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'adm_456',
        email: 'new-admin@example.com',
        isActive: true,
        createdAt: '2026-04-02T10:00:00.000Z',
        updatedAt: '2026-04-02T10:00:00.000Z',
      },
    });
    expect(db.adminAccount.create).toHaveBeenCalledWith({
      data: {
        email: 'new-admin@example.com',
        isActive: true,
        passwordHash: expect.any(String),
      },
      select: expect.any(Object),
    });

    const deleteRes = await app.request('/api/admin/admins/adm_456', {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'adm_456',
      },
    });
    expect(db.adminAccount.delete).toHaveBeenCalledWith({
      where: {
        id: 'adm_456',
      },
    });
  });
});
