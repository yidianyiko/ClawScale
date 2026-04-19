import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
}));

const mkdirSync = vi.hoisted(() => vi.fn());
const writeFileSync = vi.hoisted(() => vi.fn());
const tmpdir = vi.hoisted(() => vi.fn(() => '/tmp'));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('node:fs', () => ({ mkdirSync, writeFileSync }));
vi.mock('node:os', () => ({ tmpdir }));

import { exportLegacyCokeAuth } from './export-legacy-coke-auth.js';

describe('export legacy coke auth script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tmpdir.mockReturnValue('/tmp');
    db.$queryRaw
      .mockResolvedValueOnce([
        { row: { id: 'ck_1', email: 'alice@example.com' } },
        { row: { id: 'ck_2', email: 'bob@example.com' } },
      ])
      .mockResolvedValueOnce([
        { row: { id: 'vt_1', coke_account_id: 'ck_1', type: 'password_reset' } },
      ]);
  });

  it('exports both legacy auth tables to a timestamped temp artifact by default', async () => {
    const now = new Date('2026-04-19T04:00:00.000Z');

    await expect(exportLegacyCokeAuth(db as never, { now })).resolves.toEqual({
      exportedAt: '2026-04-19T04:00:00.000Z',
      outputPath: '/tmp/coke-auth-retirement/2026-04-19T04-00-00.000Z/legacy-coke-auth-export.json',
      cokeAccounts: 2,
      verifyTokens: 1,
    });

    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mkdirSync).toHaveBeenCalledWith(
      '/tmp/coke-auth-retirement/2026-04-19T04-00-00.000Z',
      { recursive: true, mode: 0o700 },
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      '/tmp/coke-auth-retirement/2026-04-19T04-00-00.000Z/legacy-coke-auth-export.json',
      expect.stringContaining('"verifyTokens"'),
      { encoding: 'utf8', mode: 0o600 },
    );
  });

  it('honors an explicit output path override', async () => {
    await expect(
      exportLegacyCokeAuth(db as never, {
        outputPath: '/var/backups/coke-auth-export.json',
        now: new Date('2026-04-19T05:00:00.000Z'),
      }),
    ).resolves.toEqual({
      exportedAt: '2026-04-19T05:00:00.000Z',
      outputPath: '/var/backups/coke-auth-export.json',
      cokeAccounts: 2,
      verifyTokens: 1,
    });

    expect(mkdirSync).toHaveBeenCalledWith('/var/backups', {
      recursive: true,
      mode: 0o700,
    });
    expect(writeFileSync).toHaveBeenCalledWith(
      '/var/backups/coke-auth-export.json',
      expect.stringContaining('"cokeAccounts"'),
      { encoding: 'utf8', mode: 0o600 },
    );
  });
});
