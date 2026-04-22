export interface GoogleCalendarImportPreflightInput {
  customerId: string;
  identityId: string;
}

export interface GoogleCalendarImportPreflightReady {
  ready: true;
  conversationId: string;
  userId: string;
  characterId: string;
  timezone: string;
}

export interface GoogleCalendarImportPreflightBlocked {
  ready: false;
  blockedReason: string;
}

export interface GoogleCalendarRuntimeImportInput {
  customerId: string;
  identityId: string;
  runId: string;
  providerAccountEmail?: string | null;
  events: unknown[];
}

export interface GoogleCalendarRuntimeImportResult {
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  errorSummary: string | null;
}

function readBridgeBaseUrl(): string {
  const raw =
    process.env['COKE_BRIDGE_INBOUND_URL']?.trim() || 'http://127.0.0.1:8090/bridge/inbound';
  return raw.replace(/\/bridge\/inbound\/?$/, '');
}

function readBridgeHeaders(): Record<string, string> {
  const apiKey = process.env['COKE_BRIDGE_API_KEY']?.trim();
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readBridgeJson(response: Response): Promise<Record<string, unknown>> {
  const json = await response.json();
  if (typeof json !== 'object' || json === null) {
    throw new Error('google_calendar_bridge_invalid_response');
  }
  return json as Record<string, unknown>;
}

export async function preflightGoogleCalendarImport(
  input: GoogleCalendarImportPreflightInput,
): Promise<
  | { ok: true; data: GoogleCalendarImportPreflightReady | GoogleCalendarImportPreflightBlocked }
  | { ok: false; error: string }
> {
  const response = await fetch(`${readBridgeBaseUrl()}/bridge/internal/google-calendar-import/preflight`, {
    method: 'POST',
    headers: readBridgeHeaders(),
    body: JSON.stringify({
      customer_id: input.customerId,
      identity_id: input.identityId,
    }),
  });
  const json = await readBridgeJson(response);

  if (!response.ok || json.ok !== true) {
    return {
      ok: false,
      error: readString(json.error) ?? 'google_calendar_import_preflight_failed',
    };
  }

  const data = (json.data ?? {}) as Record<string, unknown>;
  const conversationId = readString(data.conversationId) ?? readString(data.conversation_id);
  const userId = readString(data.userId) ?? readString(data.user_id);
  const characterId = readString(data.characterId) ?? readString(data.character_id);
  const timezone = readString(data.timezone);
  const blockedReason = readString(data.blockedReason) ?? readString(data.blocked_reason);

  if (conversationId && userId && characterId && timezone) {
    return {
      ok: true,
      data: {
        ready: true,
        conversationId,
        userId,
        characterId,
        timezone,
      },
    };
  }

  return {
    ok: true,
    data: {
      ready: false,
      blockedReason: blockedReason ?? 'conversation_required',
    },
  };
}

export async function runGoogleCalendarImport(
  input: GoogleCalendarRuntimeImportInput,
): Promise<{ ok: true; data: GoogleCalendarRuntimeImportResult } | { ok: false; error: string }> {
  const response = await fetch(`${readBridgeBaseUrl()}/bridge/internal/google-calendar-import/run`, {
    method: 'POST',
    headers: readBridgeHeaders(),
    body: JSON.stringify({
      customer_id: input.customerId,
      identity_id: input.identityId,
      run_id: input.runId,
      provider_account_email: input.providerAccountEmail ?? null,
      events: input.events,
    }),
  });
  const json = await readBridgeJson(response);

  if (!response.ok || json.ok !== true) {
    return {
      ok: false,
      error: readString(json.error) ?? 'google_calendar_import_run_failed',
    };
  }

  const data = (json.data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      importedCount: readNumber(data.importedCount) ?? readNumber(data.imported_count) ?? 0,
      skippedCount: readNumber(data.skippedCount) ?? readNumber(data.skipped_count) ?? 0,
      failedCount: readNumber(data.failedCount) ?? readNumber(data.failed_count) ?? 0,
      errorSummary: readString(data.errorSummary) ?? readString(data.error_summary),
    },
  };
}
