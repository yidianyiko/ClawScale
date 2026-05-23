import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelRuntimeReminder,
  completeRuntimeReminder,
  createRuntimeReminder,
  listRuntimeCalendarFacts,
  listRuntimeReminders,
  updateRuntimeReminder,
} from './reminder-runtime-client.js';

describe('reminder runtime client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.COKE_BRIDGE_INBOUND_URL = 'http://127.0.0.1:8090/bridge/inbound';
    process.env.COKE_BRIDGE_API_KEY = 'bridge-secret';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.COKE_BRIDGE_INBOUND_URL;
    delete process.env.COKE_BRIDGE_API_KEY;
  });

  it('lists reminders through the bridge with active as the default state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: [{ id: 'rem-1', title: 'Standup', lifecycleState: 'active' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      listRuntimeReminders({
        customerId: 'ck_123',
        from: '2026-05-13',
        to: '2026-05-19',
      }),
    ).resolves.toEqual({
      ok: true,
      data: [{ id: 'rem-1', title: 'Standup', lifecycleState: 'active' }],
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/reminders?customer_id=ck_123&from=2026-05-13&to=2026-05-19&state=active',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer bridge-secret',
        },
      }),
    );
  });

  it('returns the planned bridge transport error code', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      listRuntimeReminders({
        customerId: 'ck_123',
        from: '2026-05-13',
        to: '2026-05-19',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'reminder_bridge_transport_failed',
    });
  });

  it('returns the planned invalid-response error code for empty bridge responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=UTF-8' },
      }),
    );

    await expect(
      createRuntimeReminder({
        customerId: 'ck_123',
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'reminder_bridge_invalid_response',
    });
  });

  it('returns the planned invalid-response error code for non-json bridge responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('not-json', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=UTF-8' },
      }),
    );

    await expect(
      createRuntimeReminder({
        customerId: 'ck_123',
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'reminder_bridge_invalid_response',
    });
  });

  it('sends create reminder body fields, conversation hints, and metadata but never routeKey', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { id: 'rem-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      createRuntimeReminder({
        customerId: 'ck_123',
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        rrule: 'FREQ=WEEKLY',
        businessConversationKey: 'bc-123',
        gatewayConversationId: 'gw-123',
        metadata: { shared_reminder_request_id: 'srr_1', projection_role: 'requester' },
        routeKey: 'caller-supplied-route',
      }),
    ).resolves.toEqual({ ok: true, data: { id: 'rem-1' } });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/reminders',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          customer_id: 'ck_123',
          title: 'Standup',
          localDate: '2026-05-13',
          localTime: '09:30',
          timezone: 'Asia/Tokyo',
          rrule: 'FREQ=WEEKLY',
          businessConversationKey: 'bc-123',
          gatewayConversationId: 'gw-123',
          metadata: { shared_reminder_request_id: 'srr_1', projection_role: 'requester' },
        }),
      }),
    );
  });

  it('updates reminder fields without forwarding customer overrides from caller body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { id: 'rem-1', title: 'Updated' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      updateRuntimeReminder({
        customerId: 'ck_123',
        reminderId: 'rem-1',
        title: 'Updated',
        localDate: '2026-05-14',
        localTime: '10:00',
        timezone: 'Asia/Tokyo',
        customer_id: 'ck_attacker',
      }),
    ).resolves.toEqual({ ok: true, data: { id: 'rem-1', title: 'Updated' } });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/reminders/rem-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          customer_id: 'ck_123',
          title: 'Updated',
          localDate: '2026-05-14',
          localTime: '10:00',
          timezone: 'Asia/Tokyo',
        }),
      }),
    );
  });

  it('sends durationMinutes to bridge create and update requests', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return new Response(JSON.stringify({ ok: true, data: { id: 'rem_1' } }), { status: 200 });
      }),
    );

    await createRuntimeReminder({
      customerId: 'acct_a',
      title: 'lesson',
      localDate: '2026-05-25',
      localTime: '10:00',
      timezone: 'Asia/Tokyo',
      durationMinutes: 60,
    });
    await updateRuntimeReminder({
      customerId: 'acct_a',
      reminderId: 'rem_1',
      localDate: '2026-05-25',
      localTime: '11:00',
      timezone: 'Asia/Tokyo',
      durationMinutes: 90,
    });

    expect(calls[0]?.body.durationMinutes).toBe(60);
    expect(calls[1]?.body.durationMinutes).toBe(90);
  });

  it('lists calendar facts through the bridge without exposing reminder details', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      listRuntimeCalendarFacts({
        customerId: 'acct_coach',
        from: '2026-05-25',
        to: '2026-05-31',
        timezone: 'Asia/Tokyo',
      }),
    ).resolves.toEqual({
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
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/reminder-calendar-facts?customer_id=acct_coach&from=2026-05-25&to=2026-05-31&timezone=Asia%2FTokyo',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('normalizes bridge errors and preserves conversation_required', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'conversation_required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      createRuntimeReminder({
        customerId: 'ck_123',
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
      }),
    ).resolves.toEqual({ ok: false, error: 'conversation_required' });
  });

  it('sends complete and cancel commands with the authenticated customer id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { id: 'rem-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await completeRuntimeReminder({ customerId: 'ck_123', reminderId: 'rem-1' });
    await cancelRuntimeReminder({ customerId: 'ck_123', reminderId: 'rem-2' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8090/bridge/internal/reminders/rem-1/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ customer_id: 'ck_123' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8090/bridge/internal/reminders/rem-2/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ customer_id: 'ck_123' }),
      }),
    );
  });
});
