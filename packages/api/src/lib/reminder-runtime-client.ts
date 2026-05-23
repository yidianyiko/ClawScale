export type ReminderRuntimeRecord = Record<string, unknown>;

export interface ListRemindersInput {
  customerId: string;
  from: string;
  to: string;
  states?: string[];
}

export interface CreateReminderInput {
  customerId: string;
  title: string;
  localDate: string;
  localTime: string;
  timezone: string;
  rrule?: string | null;
  businessConversationKey?: string | null;
  gatewayConversationId?: string | null;
  metadata?: Record<string, unknown>;
  durationMinutes?: number | null;
}

export interface UpdateReminderInput {
  customerId: string;
  reminderId: string;
  title?: string;
  localDate?: string;
  localTime?: string;
  timezone?: string;
  rrule?: string | null;
  durationMinutes?: number | null;
  [key: string]: unknown;
}

export interface ReminderCommandInput {
  customerId: string;
  reminderId: string;
}

export type ReminderRuntimeResult<T = ReminderRuntimeRecord | ReminderRuntimeRecord[]> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

async function readBridgeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      throw new Error('reminder_bridge_invalid_response');
    }

    const json = JSON.parse(text) as unknown;
    if (typeof json !== 'object' || json === null) {
      throw new Error('reminder_bridge_invalid_response');
    }

    return json as Record<string, unknown>;
  } catch {
    throw new Error('reminder_bridge_invalid_response');
  }
}

async function requestBridgeJson(
  path: string,
  init: RequestInit,
): Promise<{ ok: true; response: Response; json: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${readBridgeBaseUrl()}${path}`, {
      ...init,
      headers: readBridgeHeaders(),
    });
  } catch {
    return { ok: false, error: 'reminder_bridge_transport_failed' };
  }

  try {
    const json = await readBridgeJson(response);
    return { ok: true, response, json };
  } catch {
    return { ok: false, error: 'reminder_bridge_invalid_response' };
  }
}

function bridgeFailureError(
  bridge: { error: string } | { response: Response; json: Record<string, unknown> },
): string {
  if ('error' in bridge) {
    return bridge.error;
  }
  if (!bridge.response.ok || bridge.json.ok !== true) {
    return readString(bridge.json.error) ?? 'reminder_request_failed';
  }
  return 'reminder_request_failed';
}

function readBridgeData<T>(json: Record<string, unknown>): T {
  return (json.data ?? {}) as T;
}

function appendStates(url: URL, states: string[] | undefined): void {
  const selectedStates = states && states.length > 0 ? states : ['active'];
  for (const state of selectedStates) {
    url.searchParams.append('state', state);
  }
}

export async function listRuntimeReminders(
  input: ListRemindersInput,
): Promise<ReminderRuntimeResult<ReminderRuntimeRecord[]>> {
  const url = new URL(`${readBridgeBaseUrl()}/bridge/internal/reminders`);
  url.searchParams.set('customer_id', input.customerId);
  url.searchParams.set('from', input.from);
  url.searchParams.set('to', input.to);
  appendStates(url, input.states);

  const bridge = await requestBridgeJson(`${url.pathname}${url.search}`, {
    method: 'GET',
  });
  if (!bridge.ok) {
    return { ok: false, error: bridgeFailureError(bridge) };
  }
  if (!bridge.response.ok || bridge.json.ok !== true) {
    return { ok: false, error: bridgeFailureError(bridge) };
  }
  const data = readBridgeData<unknown>(bridge.json);
  return { ok: true, data: Array.isArray(data) ? (data as ReminderRuntimeRecord[]) : [] };
}

export async function createRuntimeReminder(
  input: CreateReminderInput,
): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>> {
  const body: Record<string, unknown> = {
    customer_id: input.customerId,
    title: input.title,
    localDate: input.localDate,
    localTime: input.localTime,
    timezone: input.timezone,
    ...(input.rrule !== undefined ? { rrule: input.rrule } : {}),
    ...(input.businessConversationKey ? { businessConversationKey: input.businessConversationKey } : {}),
    ...(input.gatewayConversationId ? { gatewayConversationId: input.gatewayConversationId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
  };
  return writeReminder('/bridge/internal/reminders', 'POST', body);
}

export async function updateRuntimeReminder(
  input: UpdateReminderInput,
): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>> {
  const body: Record<string, unknown> = {
    customer_id: input.customerId,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.localDate !== undefined ? { localDate: input.localDate } : {}),
    ...(input.localTime !== undefined ? { localTime: input.localTime } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.rrule !== undefined ? { rrule: input.rrule } : {}),
    ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
  };
  return writeReminder(`/bridge/internal/reminders/${encodeURIComponent(input.reminderId)}`, 'PATCH', body);
}

export async function completeRuntimeReminder(
  input: ReminderCommandInput,
): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>> {
  return writeReminder(
    `/bridge/internal/reminders/${encodeURIComponent(input.reminderId)}/complete`,
    'POST',
    { customer_id: input.customerId },
  );
}

export async function cancelRuntimeReminder(
  input: ReminderCommandInput,
): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>> {
  return writeReminder(
    `/bridge/internal/reminders/${encodeURIComponent(input.reminderId)}/cancel`,
    'POST',
    { customer_id: input.customerId },
  );
}

async function writeReminder(
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>> {
  const bridge = await requestBridgeJson(path, {
    method,
    body: JSON.stringify(body),
  });
  if (!bridge.ok) {
    return { ok: false, error: bridgeFailureError(bridge) };
  }
  if (!bridge.response.ok || bridge.json.ok !== true) {
    return { ok: false, error: bridgeFailureError(bridge) };
  }
  return { ok: true, data: readBridgeData<ReminderRuntimeRecord>(bridge.json) };
}
