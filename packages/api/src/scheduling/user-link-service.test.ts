import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLinkSession,
  getOrCreateActiveUserLink,
  resetUserLink,
} from './user-link-service.js';

const db = {
  userLink: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  linkSession: { create: vi.fn() },
  customer: { findUnique: vi.fn() },
};

describe('user link service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_CLIENT = 'https://kap.example';
  });

  it('creates a first active user link with shareable profile fields', async () => {
    db.userLink.findFirst.mockResolvedValueOnce(null);
    db.customer.findUnique.mockResolvedValueOnce({
      id: 'ck_a',
      displayName: 'Coach A',
      tagline: 'Strength coaching',
      avatarUrl: 'https://img.example/a.png',
    });
    db.userLink.create.mockResolvedValueOnce({ id: 'ul_1', code: 'AbCdEfGhIjK_', status: 'active' });

    const result = await getOrCreateActiveUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(result.url).toBe('https://kap.example/u/AbCdEfGhIjK_');
    expect(result.profile).toEqual({
      displayName: 'Coach A',
      tagline: 'Strength coaching',
      avatarUrl: 'https://img.example/a.png',
    });
    expect(db.userLink.create.mock.calls[0][0].data.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('resets by disabling the old active code and creating a new one', async () => {
    db.customer.findUnique.mockResolvedValueOnce({ id: 'ck_a', displayName: 'Coach A', tagline: null, avatarUrl: null });
    db.userLink.create.mockResolvedValueOnce({ id: 'ul_2', code: 'NewCode123__', status: 'active' });

    await resetUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(db.userLink.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'disabled', disabledAt: expect.any(Date) },
    });
    expect(db.userLink.create).toHaveBeenCalled();
  });

  it('opens a link session with token hash and 24 hour expiry', async () => {
    db.userLink.findFirst.mockResolvedValueOnce({
      id: 'ul_1',
      code: 'AbCdEfGhIjK_',
      status: 'active',
      providerAccountId: 'ck_a',
    });
    db.linkSession.create.mockImplementation(async ({ data }) => ({ id: 'ls_1', ...data }));

    const result = await createLinkSession(db as never, { code: 'AbCdEfGhIjK_' });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.nextUrl).toContain('/auth/login?next=');
    expect(db.linkSession.create.mock.calls[0][0].data.tokenHash).not.toBe(result.token);
    expect(db.linkSession.create.mock.calls[0][0].data.status).toBe('opened');
  });
});
