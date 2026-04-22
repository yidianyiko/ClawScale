import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  preflightGoogleCalendarImport,
  runGoogleCalendarImport,
} from './google-calendar-runtime-client.js';

describe('google calendar runtime client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.COKE_BRIDGE_INBOUND_URL = 'http://127.0.0.1:8090/bridge/inbound';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.COKE_BRIDGE_INBOUND_URL;
    delete process.env.COKE_BRIDGE_API_KEY;
  });

  it('normalizes bridge transport failures for preflight', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      preflightGoogleCalendarImport({
        customerId: 'ck_123',
        identityId: 'idt_123',
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'google_calendar_import_preflight_transport_failed',
    });
  });

  it('normalizes empty or non-json bridge responses for import execution', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 502,
        headers: {
          'content-type': 'text/plain; charset=UTF-8',
        },
      }),
    );

    await expect(
      runGoogleCalendarImport({
        customerId: 'ck_123',
        identityId: 'idt_123',
        runId: 'cir_123',
        events: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'google_calendar_import_run_invalid_response',
    });
  });

  it('sends calendar defaults and raw event payloads to the bridge runtime', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            importedCount: 1,
            skippedCount: 0,
            failedCount: 0,
            errorSummary: null,
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const calendarDefaults = {
      timezone: 'America/Los_Angeles',
      defaultReminders: [{ method: 'popup', minutes: 30 }],
    };
    const event = {
      id: 'evt_series',
      status: 'confirmed',
      summary: 'Recurring check-in',
      start: {
        dateTime: '2026-04-24T09:00:00-07:00',
        timeZone: 'America/Los_Angeles',
      },
      end: {
        dateTime: '2026-04-24T09:30:00-07:00',
        timeZone: 'America/Los_Angeles',
      },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'],
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }],
      },
    };

    await expect(
      runGoogleCalendarImport({
        customerId: 'ck_123',
        identityId: 'idt_123',
        runId: 'cir_123',
        providerAccountEmail: 'alice@example.com',
        calendarDefaults,
        events: [event],
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        importedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        errorSummary: null,
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/internal/google-calendar-import/run',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: 'ck_123',
          identity_id: 'idt_123',
          run_id: 'cir_123',
          provider_account_email: 'alice@example.com',
          calendar_defaults: {
            timezone: 'America/Los_Angeles',
            defaultReminders: [{ method: 'popup', minutes: 30 }],
          },
          events: [event],
        }),
      }),
    );
  });
});
