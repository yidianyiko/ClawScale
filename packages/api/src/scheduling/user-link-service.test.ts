import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimLinkSession,
  createLinkSession,
  disableUserLink,
  getOrCreateActiveUserLink,
  readPublicUserLinkByCode,
  resetUserLink,
} from './user-link-service.js';

const db = {
  userLink: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  linkSession: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  customer: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

describe('user link service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn) => fn(db));
    process.env.DOMAIN_CLIENT = 'https://kap.example';
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(result.qrUrl).toBe('https://kap.example/u/AbCdEfGhIjK_/qr');
    expect(result.profile).toEqual({
      displayName: 'Coach A',
      tagline: 'Strength coaching',
      avatarUrl: 'https://img.example/a.png',
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('providerAccountId');
    expect(db.userLink.create.mock.calls[0][0].data.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('re-reads the active user link when first creation loses a unique race', async () => {
    db.userLink.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ul_1', code: 'RaceWin123_', status: 'active', providerAccountId: 'ck_a' });
    db.userLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    db.customer.findUnique.mockResolvedValueOnce({
      id: 'ck_a',
      displayName: 'Coach A',
      tagline: null,
      avatarUrl: null,
    });

    const result = await getOrCreateActiveUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(result.url).toBe('https://kap.example/u/RaceWin123_');
    expect(db.userLink.findFirst).toHaveBeenCalledTimes(2);
  });

  it('resets by disabling the old active code and creating a new one', async () => {
    db.customer.findUnique.mockResolvedValueOnce({ id: 'ck_a', displayName: 'Coach A', tagline: null, avatarUrl: null });
    db.userLink.create.mockResolvedValueOnce({ id: 'ul_2', code: 'NewCode123__', status: 'active' });

    const result = await resetUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(db.userLink.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'disabled', disabledAt: expect.any(Date) },
    });
    expect(result.qrUrl).toBe('https://kap.example/u/NewCode123__/qr');
    expect(db.userLink.create).toHaveBeenCalled();
  });

  it('uses a transaction for reset when the root client supports it', async () => {
    const tx = {
      userLink: { updateMany: vi.fn(), create: vi.fn() },
    };
    db.$transaction.mockImplementationOnce(async (fn) => fn(tx));
    tx.userLink.create.mockResolvedValueOnce({ id: 'ul_2', code: 'NewCode123__', status: 'active' });
    db.customer.findUnique.mockResolvedValueOnce({ id: 'ck_a', displayName: 'Coach A', tagline: null, avatarUrl: null });

    await resetUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.userLink.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'disabled', disabledAt: expect.any(Date) },
    });
    expect(tx.userLink.create).toHaveBeenCalled();
    expect(db.userLink.updateMany).not.toHaveBeenCalled();
  });

  it('re-reads active link when concurrent reset creation loses a unique race', async () => {
    db.userLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    db.userLink.findFirst.mockResolvedValueOnce({
      id: 'ul_race',
      code: 'ResetRace12_',
      status: 'active',
      providerAccountId: 'ck_a',
    });
    db.customer.findUnique.mockResolvedValueOnce({ id: 'ck_a', displayName: 'Coach A', tagline: null, avatarUrl: null });

    const result = await resetUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(result.url).toBe('https://kap.example/u/ResetRace12_');
    expect(result.qrUrl).toBe('https://kap.example/u/ResetRace12_/qr');
    expect(db.userLink.findFirst).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('reads only an active public user link by code without exposing provider account id', async () => {
    db.userLink.findFirst.mockResolvedValueOnce({
      id: 'ul_1',
      code: 'AbCdEfGhIjK_',
      status: 'active',
      providerAccountId: 'ck_a',
    });
    db.customer.findUnique.mockResolvedValueOnce({
      id: 'ck_a',
      displayName: 'Coach A',
      tagline: 'Strength coaching',
      avatarUrl: null,
    });

    const result = await readPublicUserLinkByCode(db as never, { code: 'AbCdEfGhIjK_' });

    expect(db.userLink.findFirst).toHaveBeenCalledWith({
      where: { code: 'AbCdEfGhIjK_', status: 'active' },
    });
    expect(result).toMatchObject({
      code: 'AbCdEfGhIjK_',
      status: 'active',
      qrUrl: 'https://kap.example/u/AbCdEfGhIjK_/qr',
      profile: { displayName: 'Coach A', tagline: 'Strength coaching', avatarUrl: null },
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('providerAccountId');
  });

  it('disables active user links without creating a replacement', async () => {
    db.userLink.updateMany.mockResolvedValueOnce({ count: 1 });

    await disableUserLink(db as never, { providerAccountId: 'ck_a' });

    expect(db.userLink.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'disabled', disabledAt: expect.any(Date) },
    });
    expect(db.userLink.create).not.toHaveBeenCalled();
  });

  it('opens a link session with token hash and 24 hour expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
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
    expect(result.registerUrl).toContain('/auth/register?next=');
    expect(db.linkSession.create.mock.calls[0][0].data.tokenHash).not.toBe(result.token);
    expect(db.linkSession.create.mock.calls[0][0].data.tokenHash).toHaveLength(64);
    expect(db.linkSession.create.mock.calls[0][0].data.userLinkId).toBe('ul_1');
    expect(db.linkSession.create.mock.calls[0][0].data.providerAccountId).toBe('ck_a');
    expect(db.linkSession.create.mock.calls[0][0].data.status).toBe('opened');
    expect(db.linkSession.create.mock.calls[0][0].data.expiresAt).toEqual(
      new Date('2026-05-22T00:00:00.000Z'),
    );
    expect(result.nextUrl).toContain(encodeURIComponent(`link_session=${result.token}`));
    expect(result).not.toHaveProperty('session');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('userLinkId');
    expect(result).not.toHaveProperty('providerAccountId');
  });

  it('fails closed for the retired link-session claim write path', async () => {
    await expect(
      claimLinkSession(db as never, {
        token: 'session-token',
        consumerAccountId: 'ck_b',
      }),
    ).rejects.toThrow('appointment_scheduling_retired');

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.linkSession.findUnique).not.toHaveBeenCalled();
    expect(db.linkSession.updateMany).not.toHaveBeenCalled();
  });
});
