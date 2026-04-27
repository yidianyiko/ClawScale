import { describe, expect, it, vi } from 'vitest';
import { buildGoogleCalendarAuthUrl } from './google-calendar-oauth.js';

describe('google calendar oauth', () => {
  it('requests event and calendar-list readonly scopes needed by import', async () => {
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', 'client-id.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CALENDAR_STATE_SECRET', 'state-secret');

    const url = new URL(await buildGoogleCalendarAuthUrl({
      runId: 'cir_1',
      customerId: 'ck_1',
      identityId: 'idt_1',
      targetTimezone: 'Asia/Tokyo',
      redirectUri: 'http://localhost:8080/api/customer/google-calendar-import/callback/google',
    }));

    const scopes = new Set(url.searchParams.get('scope')?.split(' ') ?? []);
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events.readonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
  });
});
