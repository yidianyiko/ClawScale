import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_READONLY_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const GOOGLE_STATE_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '10m';

export interface GoogleCalendarAuthUrlInput {
  runId: string;
  customerId: string;
  identityId: string;
  targetTimezone: string;
  redirectUri: string;
}

export interface GoogleCalendarStatePayload {
  runId: string;
  customerId: string;
  identityId: string;
  codeVerifier: string;
  targetTimezone: string;
}

export interface GoogleCalendarTokenExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  providerAccountEmail: string | null;
}

export interface GoogleCalendarEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarDefaultReminder {
  method?: string;
  minutes?: number;
}

export interface GooglePrimaryCalendarDefaults {
  timezone: string | null;
  defaultReminders: GoogleCalendarDefaultReminder[];
}

export interface GoogleCalendarEventRecord {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventTime;
  end?: GoogleCalendarEventTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleCalendarEventTime;
  reminders?: {
    useDefault?: boolean;
    overrides?: GoogleCalendarDefaultReminder[];
  };
  recurringEventSource?: {
    url?: string;
    title?: string;
  };
  htmlLink?: string;
  [key: string]: unknown;
}

export interface GooglePrimaryCalendarEventsResult {
  providerAccountEmail: string | null;
  calendarDefaults: GooglePrimaryCalendarDefaults;
  events: GoogleCalendarEventRecord[];
}

function readGoogleCalendarClientId(): string {
  const value = process.env['GOOGLE_CALENDAR_CLIENT_ID']?.trim();
  if (!value) {
    throw new Error('GOOGLE_CALENDAR_CLIENT_ID is required');
  }
  return value;
}

function readGoogleCalendarClientSecret(): string {
  const value = process.env['GOOGLE_CALENDAR_CLIENT_SECRET']?.trim();
  if (!value) {
    throw new Error('GOOGLE_CALENDAR_CLIENT_SECRET is required');
  }
  return value;
}

function readGoogleCalendarStateSecret(): string {
  const value =
    process.env['GOOGLE_CALENDAR_STATE_SECRET']?.trim() ??
    process.env['CUSTOMER_JWT_SECRET']?.trim();
  if (!value) {
    throw new Error('GOOGLE_CALENDAR_STATE_SECRET or CUSTOMER_JWT_SECRET is required');
  }
  return value;
}

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createCodeVerifier(): string {
  return base64Url(randomBytes(64));
}

function createCodeChallenge(codeVerifier: string): string {
  return base64Url(createHash('sha256').update(codeVerifier).digest());
}

function signGoogleCalendarState(input: GoogleCalendarStatePayload): string {
  return jwt.sign(
    {
      sub: input.customerId,
      identityId: input.identityId,
      runId: input.runId,
      codeVerifier: input.codeVerifier,
      targetTimezone: input.targetTimezone,
      tokenType: 'action',
      purpose: 'google_calendar_import',
    },
    readGoogleCalendarStateSecret(),
    { expiresIn: GOOGLE_STATE_EXPIRES_IN },
  );
}

export function verifyGoogleCalendarState(state: string): GoogleCalendarStatePayload {
  const payload = jwt.verify(state, readGoogleCalendarStateSecret()) as {
    sub: string;
    identityId: string;
    runId: string;
    codeVerifier: string;
    targetTimezone: string;
    purpose?: string;
  };

  if (
    payload.purpose !== 'google_calendar_import' ||
    !payload.sub ||
    !payload.identityId ||
    !payload.runId ||
    !payload.codeVerifier ||
    !payload.targetTimezone
  ) {
    throw new Error('invalid_google_calendar_state');
  }

  return {
    customerId: payload.sub,
    identityId: payload.identityId,
    runId: payload.runId,
    codeVerifier: payload.codeVerifier,
    targetTimezone: payload.targetTimezone,
  };
}

export async function buildGoogleCalendarAuthUrl(
  input: GoogleCalendarAuthUrlInput,
): Promise<string> {
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = signGoogleCalendarState({
    runId: input.runId,
    customerId: input.customerId,
    identityId: input.identityId,
    codeVerifier,
    targetTimezone: input.targetTimezone,
  });

  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('client_id', readGoogleCalendarClientId());
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_READONLY_SCOPES.join(' '));
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', codeChallenge);

  return url.toString();
}

export async function exchangeGoogleCalendarCode(
  input: GoogleCalendarTokenExchangeInput,
): Promise<GoogleCalendarTokens> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: readGoogleCalendarClientId(),
    client_secret: readGoogleCalendarClientSecret(),
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const json = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    expires_in?: number;
    id_token?: string;
    error?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new Error(json.error || 'google_calendar_token_exchange_failed');
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiryDate:
      json.expiry_date ??
      (typeof json.expires_in === 'number' ? Date.now() + json.expires_in * 1000 : null),
    providerAccountEmail: null,
  };
}

async function fetchJson(url: string, accessToken: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const json = await response.json();
  if (!response.ok) {
    const error = (json as { error?: { message?: string } }).error?.message;
    throw new Error(error || 'google_calendar_api_failed');
  }

  return json;
}

export async function fetchGooglePrimaryCalendarEvents(
  accessToken: string,
): Promise<GooglePrimaryCalendarEventsResult> {
  const primaryCalendar = await fetchJson(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary',
    accessToken,
  ) as {
    id?: string;
    timeZone?: string;
    defaultReminders?: Array<GoogleCalendarDefaultReminder>;
  };

  const events: GoogleCalendarEventRecord[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('maxResults', '2500');
    url.searchParams.set('showDeleted', 'true');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const page = await fetchJson(url.toString(), accessToken) as {
      items?: Array<GoogleCalendarEventRecord>;
      nextPageToken?: string;
    };

    if (Array.isArray(page.items)) {
      events.push(...page.items);
    }

    pageToken = page.nextPageToken;
  } while (pageToken);

  return {
    providerAccountEmail: primaryCalendar.id ?? null,
    calendarDefaults: {
      timezone: primaryCalendar.timeZone ?? null,
      defaultReminders: Array.isArray(primaryCalendar.defaultReminders)
        ? primaryCalendar.defaultReminders
        : [],
    },
    events,
  };
}
