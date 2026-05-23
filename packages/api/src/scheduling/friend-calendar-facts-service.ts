import type {
  ListCalendarFactsInput,
  ReminderRuntimeRecord,
  ReminderRuntimeResult,
} from '../lib/reminder-runtime-client.js';
import type { FriendCalendarBusyInterval, FriendCalendarFactsResult } from './types.js';

interface FriendshipRecord {
  id: string;
  accountAId: string;
  accountBId: string;
  status: 'active' | 'removed';
}

export interface FriendCalendarFactsClient {
  friendship: {
    findFirst(args: { where: Record<string, unknown> }): Promise<FriendshipRecord | null>;
  };
}

export interface FriendCalendarFactsRuntimePort {
  listRuntimeCalendarFacts(input: ListCalendarFactsInput): Promise<ReminderRuntimeResult<ReminderRuntimeRecord>>;
}

export interface ListFriendCalendarFactsInput {
  requesterAccountId: string;
  targetAccountId: string;
  fromDate: string;
  toDate: string;
  timezone: string;
}

function nonEmpty(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(code);
  }
  return trimmed;
}

async function findActiveFriendship(
  client: FriendCalendarFactsClient,
  accountAId: string,
  accountBId: string,
): Promise<FriendshipRecord | null> {
  return client.friendship.findFirst({
    where: {
      status: 'active',
      OR: [
        { accountAId, accountBId },
        { accountAId: accountBId, accountBId: accountAId },
      ],
    },
  });
}

function normalizeBusyIntervals(value: unknown): FriendCalendarBusyInterval[] {
  const intervals = Array.isArray(value) ? value : [];
  return intervals
    .map((item) => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      start_at: String(item['startAt'] ?? ''),
      end_at: String(item['endAt'] ?? ''),
      local_start: String(item['localStart'] ?? ''),
      local_end: String(item['localEnd'] ?? ''),
    }))
    .filter((item) => item.start_at && item.end_at && item.local_start && item.local_end);
}

export async function listFriendCalendarFacts(
  client: FriendCalendarFactsClient,
  reminderRuntime: FriendCalendarFactsRuntimePort,
  input: ListFriendCalendarFactsInput,
): Promise<FriendCalendarFactsResult> {
  const requesterAccountId = nonEmpty(input.requesterAccountId, 'invalid_account');
  const targetAccountId = nonEmpty(input.targetAccountId, 'invalid_account');
  const fromDate = nonEmpty(input.fromDate, 'invalid_body');
  const toDate = nonEmpty(input.toDate, 'invalid_body');
  const timezone = nonEmpty(input.timezone, 'invalid_body');

  const friendship = await findActiveFriendship(client, requesterAccountId, targetAccountId);
  if (!friendship) {
    return {
      status: 'friendship_required',
      target_account_id: targetAccountId,
      busy_intervals: [],
      privacy: { event_details_included: false },
    };
  }

  const facts = await reminderRuntime.listRuntimeCalendarFacts({
    customerId: targetAccountId,
    from: fromDate,
    to: toDate,
    timezone,
  });
  if (!facts.ok) {
    throw new Error(facts.error);
  }

  const data = facts.data;
  const rawRange = data['range'];
  const range =
    typeof rawRange === 'object' && rawRange !== null
      ? (rawRange as Record<string, unknown>)
      : { from: fromDate, to: toDate, timezone };

  return {
    target_account_id: targetAccountId,
    range: {
      from: String(range['from'] ?? fromDate),
      to: String(range['to'] ?? toDate),
      timezone: String(range['timezone'] ?? timezone),
    },
    busy_intervals: normalizeBusyIntervals(data['busyIntervals']),
    privacy: { event_details_included: false },
  };
}
