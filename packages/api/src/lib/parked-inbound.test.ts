import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client = {
    parkedInbound: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(client)),
  } as any;

  return client;
});

vi.mock('../db/index.js', () => ({ db }));

import { drainParkedInbounds, queueParkedInbound } from './parked-inbound.js';

describe('parked inbound helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(db));
  });

  it('queues a parked inbound row with queued status', async () => {
    const created = {
      id: 'pi_1',
      channelId: 'ch_1',
      provider: 'whatsapp',
      identityType: 'wa_id',
      identityValue: '14155550100',
      payload: { text: 'hello' },
      status: 'queued',
      attempts: 0,
      lastError: null,
      drainedAt: null,
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
      updatedAt: new Date('2026-04-17T00:00:00.000Z'),
    };
    db.parkedInbound.create.mockResolvedValue(created);

    await expect(
      queueParkedInbound({
        channelId: 'ch_1',
        provider: 'whatsapp',
        identityType: 'wa_id',
        identityValue: '14155550100',
        payload: { text: 'hello' },
      }),
    ).resolves.toEqual(created);

    expect(db.parkedInbound.create).toHaveBeenCalledWith({
      data: {
        channelId: 'ch_1',
        provider: 'whatsapp',
        identityType: 'wa_id',
        identityValue: '14155550100',
        payload: { text: 'hello' },
        status: 'queued',
      },
    });
  });

  it('drains parked inbound rows in arrival order', async () => {
    const older = {
      id: 'pi_1',
      channelId: 'ch_1',
      provider: 'whatsapp',
      identityType: 'wa_id',
      identityValue: '14155550100',
      payload: { text: 'first' },
      status: 'queued',
      attempts: 0,
      lastError: null,
      drainedAt: null,
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
      updatedAt: new Date('2026-04-17T00:00:00.000Z'),
    };
    const newer = {
      id: 'pi_2',
      channelId: 'ch_1',
      provider: 'whatsapp',
      identityType: 'wa_id',
      identityValue: '14155550101',
      payload: { text: 'second' },
      status: 'queued',
      attempts: 0,
      lastError: null,
      drainedAt: null,
      createdAt: new Date('2026-04-17T00:00:01.000Z'),
      updatedAt: new Date('2026-04-17T00:00:01.000Z'),
    };

    db.parkedInbound.findMany.mockResolvedValue([newer, older]);
    db.parkedInbound.update.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const row = where.id === older.id ? older : newer;
      return {
        ...row,
        status: 'drained',
        drainedAt: new Date('2026-04-17T00:00:10.000Z'),
      };
    });

    await expect(drainParkedInbounds({ channelId: 'ch_1' })).resolves.toEqual([
      {
        ...older,
        status: 'drained',
        drainedAt: new Date('2026-04-17T00:00:10.000Z'),
      },
      {
        ...newer,
        status: 'drained',
        drainedAt: new Date('2026-04-17T00:00:10.000Z'),
      },
    ]);

    expect(db.parkedInbound.findMany).toHaveBeenCalledWith({
      where: {
        channelId: 'ch_1',
        status: 'queued',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(db.parkedInbound.update.mock.calls.map(([args]: [any]) => args.where.id)).toEqual([
      'pi_1',
      'pi_2',
    ]);
  });
});
