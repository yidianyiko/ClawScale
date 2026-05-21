import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeBookableWindow,
  confirmBookableWindowPreview,
  previewBookableWindows,
} from './availability-service.js';
import { buildRuleFingerprint } from './time.js';

const client = {
  bookableWindow: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  appointmentRequest: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  appointmentEvent: {
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

describe('availability service', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    client.$transaction.mockImplementation(async (fn) => fn(client));
  });

  it('previews parsed weekly Chinese windows and requires confirmation before commit', async () => {
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));

    const preview = await previewBookableWindows({
      providerAccountId: 'ck_a',
      instruction: '每周二和周四晚上 7 点到 9 点可以约训练',
      timezone: 'Asia/Shanghai',
    });

    expect(preview.previewId).toMatch(/^bwp_/);
    expect(preview.windows).toHaveLength(1);
    expect(preview.windows[0]).toMatchObject({
      rule: {
        type: 'weekly',
        days_of_week: [2, 4],
        time_start: '19:00',
        time_end: '21:00',
        timezone: 'Asia/Shanghai',
        effective_from: '2026-05-21',
        effective_until: null,
      },
      fingerprint: expect.any(String),
    });
    expect(client.bookableWindow.create).not.toHaveBeenCalled();
    expect(client.bookableWindow.updateMany).not.toHaveBeenCalled();
  });

  it('deduplicates identical active window rules on confirm', async () => {
    const rule = {
      type: 'weekly' as const,
      days_of_week: [2],
      time_start: '19:00',
      time_end: '21:00',
      timezone: 'Asia/Shanghai',
      effective_from: '2026-06-01',
      effective_until: null,
    };
    const fingerprint = buildRuleFingerprint(rule);
    client.bookableWindow.findFirst.mockResolvedValueOnce({
      id: 'bw_existing',
      status: 'active',
    });

    const result = await confirmBookableWindowPreview(client as never, {
      providerAccountId: 'ck_a',
      preview: {
        previewId: 'bwp_1',
        windows: [
          {
            rule,
            fingerprint,
          },
        ],
      },
    });

    expect(result).toEqual({ createdIds: [], reusedIds: ['bw_existing'] });
    expect(client.bookableWindow.findFirst).toHaveBeenCalledWith({
      where: {
        providerAccountId: 'ck_a',
        capability: 'appointment_request',
        ruleFingerprint: fingerprint,
        status: 'active',
      },
    });
    expect(client.bookableWindow.create).not.toHaveBeenCalled();
  });

  it('warns before closing a rule that has pending held requests', async () => {
    client.appointmentRequest.findMany.mockResolvedValueOnce([{ id: 'ar_1' }, { id: 'ar_2' }]);

    const result = await closeBookableWindow(client as never, {
      providerAccountId: 'ck_a',
      bookableWindowId: 'bw_1',
      confirmCancelPending: false,
    });

    expect(result).toEqual({
      ok: false,
      error: 'pending_requests_require_confirmation',
      pendingCount: 2,
    });
    expect(client.bookableWindow.updateMany).not.toHaveBeenCalled();
    expect(client.appointmentRequest.updateMany).not.toHaveBeenCalled();
    expect(client.appointmentEvent.createMany).not.toHaveBeenCalled();
  });

  it('closes and releases pending requests atomically when confirmation is provided', async () => {
    client.appointmentRequest.findMany.mockResolvedValueOnce([{ id: 'ar_1' }, { id: 'ar_2' }]);
    client.bookableWindow.updateMany.mockResolvedValueOnce({ count: 1 });
    client.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 2 });

    const result = await closeBookableWindow(client as never, {
      providerAccountId: 'ck_a',
      bookableWindowId: 'bw_1',
      confirmCancelPending: true,
    });

    expect(result).toEqual({ ok: true, cancelledPendingCount: 2 });
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.bookableWindow.updateMany).toHaveBeenCalledWith({
      where: { id: 'bw_1', providerAccountId: 'ck_a', status: 'active' },
      data: { status: 'closed', closedAt: expect.any(Date) },
    });
    expect(client.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ar_1', 'ar_2'] }, status: 'pending_held' },
      data: { status: 'released', releaseReason: 'cancelled_by_a', releasedAt: expect.any(Date) },
    });
    expect(client.appointmentEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          appointmentId: 'ar_1',
          fromState: 'pending_held',
          toState: 'released',
          actorAccountId: 'ck_a',
          actorRole: 'provider',
          reason: 'cancelled_by_a',
        }),
        expect.objectContaining({
          appointmentId: 'ar_2',
          fromState: 'pending_held',
          toState: 'released',
          actorAccountId: 'ck_a',
          actorRole: 'provider',
          reason: 'cancelled_by_a',
        }),
      ],
    });
  });
});
