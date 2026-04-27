import type { GooglePrimaryCalendarDefaults } from './google-calendar-oauth.js';

export interface GoogleCalendarImportPreflightInput {
  customerId: string;
  identityId: string;
  businessConversationKey?: string | null;
  gatewayConversationId?: string | null;
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
  targetConversationId: string;
  targetCharacterId: string;
  targetTimezone: string;
  calendarDefaults: GooglePrimaryCalendarDefaults;
  events: unknown[];
}

export interface GoogleCalendarImportWarning {
  [key: string]: unknown;
}

export interface GoogleCalendarRuntimeImportResult {
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  warningCount: number;
  warnings: GoogleCalendarImportWarning[];
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

function readWarnings(value: unknown): GoogleCalendarImportWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is GoogleCalendarImportWarning =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

async function readBridgeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      throw new Error('google_calendar_bridge_invalid_response');
    }

    const json = JSON.parse(text) as unknown;
    if (typeof json !== 'object' || json === null) {
      throw new Error('google_calendar_bridge_invalid_response');
    }

    return json as Record<string, unknown>;
  } catch {
    throw new Error('google_calendar_bridge_invalid_response');
  }
}

async function postBridgeJson(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; response: Response; json: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${readBridgeBaseUrl()}${path}`, {
      method: 'POST',
      headers: readBridgeHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: 'google_calendar_bridge_transport_failed',
    };
  }

  try {
    const json = await readBridgeJson(response);
    return { ok: true, response, json };
  } catch {
    return {
      ok: false,
      error: 'google_calendar_bridge_invalid_response',
    };
  }
}

export async function preflightGoogleCalendarImport(
  input: GoogleCalendarImportPreflightInput,
): Promise<
  | { ok: true; data: GoogleCalendarImportPreflightReady | GoogleCalendarImportPreflightBlocked }
  | { ok: false; error: string }
> {
  const bridge = await postBridgeJson('/bridge/internal/google-calendar-import/preflight', {
    customer_id: input.customerId,
    identity_id: input.identityId,
    ...(input.businessConversationKey
      ? { business_conversation_key: input.businessConversationKey }
      : {}),
    ...(input.gatewayConversationId
      ? { gateway_conversation_id: input.gatewayConversationId }
      : {}),
  });
  if (!bridge.ok) {
    return {
      ok: false,
      error:
        bridge.error === 'google_calendar_bridge_transport_failed'
          ? 'google_calendar_import_preflight_transport_failed'
          : 'google_calendar_import_preflight_invalid_response',
    };
  }

  const { response, json } = bridge;

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
  const bridge = await postBridgeJson('/bridge/internal/google-calendar-import/run', {
    customer_id: input.customerId,
    identity_id: input.identityId,
    run_id: input.runId,
    provider_account_email: input.providerAccountEmail ?? null,
    target_conversation_id: input.targetConversationId,
    target_character_id: input.targetCharacterId,
    target_timezone: input.targetTimezone,
    calendar_defaults: input.calendarDefaults,
    events: input.events,
  });
  if (!bridge.ok) {
    return {
      ok: false,
      error:
        bridge.error === 'google_calendar_bridge_transport_failed'
          ? 'google_calendar_import_run_transport_failed'
          : 'google_calendar_import_run_invalid_response',
    };
  }

  const { response, json } = bridge;

  if (!response.ok || json.ok !== true) {
    return {
      ok: false,
      error: readString(json.error) ?? 'google_calendar_import_run_failed',
    };
  }

  const data = (json.data ?? {}) as Record<string, unknown>;
  const warnings = readWarnings(data.warnings);
  return {
    ok: true,
    data: {
      importedCount: readNumber(data.importedCount) ?? readNumber(data.imported_count) ?? 0,
      skippedCount: readNumber(data.skippedCount) ?? readNumber(data.skipped_count) ?? 0,
      failedCount: readNumber(data.failedCount) ?? readNumber(data.failed_count) ?? 0,
      warningCount:
        readNumber(data.warningCount) ??
        readNumber(data.warning_count) ??
        warnings.length,
      warnings,
      errorSummary: readString(data.errorSummary) ?? readString(data.error_summary),
    },
  };
}
