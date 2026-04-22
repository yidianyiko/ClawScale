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
});
