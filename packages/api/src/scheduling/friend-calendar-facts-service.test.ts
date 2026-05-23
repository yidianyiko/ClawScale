import { describe, expect, it, vi } from 'vitest';
import { listFriendCalendarFacts } from './friend-calendar-facts-service.js';

function clientWithFriendship(friendship: Record<string, unknown> | null) {
  return {
    friendship: {
      findFirst: vi.fn().mockResolvedValue(friendship),
    },
  };
}

describe('friend calendar facts service', () => {
  it('requires an active friendship before reading target calendar facts', async () => {
    const client = clientWithFriendship(null);
    const runtime = { listRuntimeCalendarFacts: vi.fn() };

    const result = await listFriendCalendarFacts(client as never, runtime, {
      requesterAccountId: 'acct_student',
      targetAccountId: 'acct_coach',
      fromDate: '2026-05-25',
      toDate: '2026-05-31',
      timezone: 'Asia/Tokyo',
    });

    expect(result).toEqual({
      status: 'friendship_required',
      target_account_id: 'acct_coach',
      busy_intervals: [],
      privacy: { event_details_included: false },
    });
    expect(runtime.listRuntimeCalendarFacts).not.toHaveBeenCalled();
  });

  it('returns privacy-preserving busy facts for active friends', async () => {
    const client = clientWithFriendship({
      id: 'fs_1',
      accountAId: 'acct_student',
      accountBId: 'acct_coach',
      status: 'active',
    });
    const runtime = {
      listRuntimeCalendarFacts: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          targetAccountId: 'acct_coach',
          range: { from: '2026-05-25', to: '2026-05-31', timezone: 'Asia/Tokyo' },
          busyIntervals: [
            {
              startAt: '2026-05-25T01:00:00+00:00',
              endAt: '2026-05-25T02:00:00+00:00',
              localStart: '2026-05-25 10:00',
              localEnd: '2026-05-25 11:00',
            },
          ],
          privacy: { eventDetailsIncluded: false },
        },
      }),
    };

    const result = await listFriendCalendarFacts(client as never, runtime, {
      requesterAccountId: 'acct_student',
      targetAccountId: 'acct_coach',
      fromDate: '2026-05-25',
      toDate: '2026-05-31',
      timezone: 'Asia/Tokyo',
    });

    expect(runtime.listRuntimeCalendarFacts).toHaveBeenCalledWith({
      customerId: 'acct_coach',
      from: '2026-05-25',
      to: '2026-05-31',
      timezone: 'Asia/Tokyo',
    });
    expect(result).toEqual({
      target_account_id: 'acct_coach',
      range: { from: '2026-05-25', to: '2026-05-31', timezone: 'Asia/Tokyo' },
      busy_intervals: [
        {
          start_at: '2026-05-25T01:00:00+00:00',
          end_at: '2026-05-25T02:00:00+00:00',
          local_start: '2026-05-25 10:00',
          local_end: '2026-05-25 11:00',
        },
      ],
      privacy: { event_details_included: false },
    });
    expect(JSON.stringify(result)).not.toContain('title');
    expect(JSON.stringify(result)).not.toContain('metadata');
  });
});
