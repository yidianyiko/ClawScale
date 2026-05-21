import { buildRuleFingerprint, validateBookableWindowRule } from './time.js';
import type { BookableWindowRule } from './types.js';

export interface BookableWindowPreview {
  previewId: string;
  windows: Array<{ rule: BookableWindowRule; fingerprint: string }>;
}

interface AvailabilityClient {
  bookableWindow: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  appointmentRequest: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<Array<{ id: string }>>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  appointmentEvent: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
  };
  $transaction?<T>(fn: (client: AvailabilityWriteClient) => Promise<T>): Promise<T>;
}

type AvailabilityWriteClient = Pick<
  AvailabilityClient,
  'bookableWindow' | 'appointmentRequest' | 'appointmentEvent'
>;

function parseChineseWeeklyInstruction(input: { instruction: string; timezone: string }): BookableWindowRule {
  const normalized = input.instruction.replace(/\s+/g, '');
  const days = [
    ...(normalized.includes('周一') || normalized.includes('星期一') ? [1] : []),
    ...(normalized.includes('周二') || normalized.includes('星期二') ? [2] : []),
    ...(normalized.includes('周三') || normalized.includes('星期三') ? [3] : []),
    ...(normalized.includes('周四') || normalized.includes('星期四') ? [4] : []),
    ...(normalized.includes('周五') || normalized.includes('星期五') ? [5] : []),
    ...(normalized.includes('周六') || normalized.includes('星期六') ? [6] : []),
    ...(normalized.includes('周日') || normalized.includes('周天') || normalized.includes('星期日') ? [7] : []),
  ];

  return validateBookableWindowRule({
    type: 'weekly',
    days_of_week: days.length > 0 ? days : [2],
    time_start: parseChineseHour(normalized, 'start'),
    time_end: parseChineseHour(normalized, 'end'),
    timezone: input.timezone,
    effective_from: new Date().toISOString().slice(0, 10),
    effective_until: null,
  });
}

function parseChineseHour(normalizedInstruction: string, side: 'start' | 'end'): string {
  const match = normalizedInstruction.match(/([0-9一二三四五六七八九十]+)点到([0-9一二三四五六七八九十]+)点/);
  if (!match) {
    return side === 'start' ? '09:00' : '10:00';
  }

  const rawHour = side === 'start' ? match[1] : match[2];
  const hour = chineseHourToNumber(rawHour ?? '');
  const isEvening = normalizedInstruction.includes('晚上') || normalizedInstruction.includes('晚间');
  const normalizedHour = isEvening && hour < 12 ? hour + 12 : hour;
  return `${String(normalizedHour).padStart(2, '0')}:00`;
}

function chineseHourToNumber(value: string): number {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === '十一') return 11;
  if (value === '十二') return 12;
  return digits[value] ?? 9;
}

async function runAvailabilityWrite<T>(
  client: AvailabilityClient,
  fn: (writeClient: AvailabilityWriteClient) => Promise<T>,
): Promise<T> {
  if (client.$transaction) {
    return client.$transaction(fn);
  }
  return fn(client);
}

export async function previewBookableWindows(input: {
  providerAccountId: string;
  instruction: string;
  timezone: string;
}): Promise<BookableWindowPreview> {
  const rule = parseChineseWeeklyInstruction(input);
  const fingerprint = buildRuleFingerprint(rule);

  return {
    previewId: `bwp_${Buffer.from(`${input.providerAccountId}:${fingerprint}`).toString('base64url').slice(0, 24)}`,
    windows: [{ rule, fingerprint }],
  };
}

export async function confirmBookableWindowPreview(
  client: AvailabilityClient,
  input: {
    providerAccountId: string;
    preview: BookableWindowPreview;
  },
): Promise<{ createdIds: string[]; reusedIds: string[] }> {
  const createdIds: string[] = [];
  const reusedIds: string[] = [];

  for (const window of input.preview.windows) {
    const fingerprint = buildRuleFingerprint(window.rule);
    const existing = await client.bookableWindow.findFirst({
      where: {
        providerAccountId: input.providerAccountId,
        capability: 'appointment_request',
        ruleFingerprint: fingerprint,
        status: 'active',
      },
    });
    if (existing) {
      reusedIds.push(existing.id);
      continue;
    }

    const created = await client.bookableWindow.create({
      data: {
        providerAccountId: input.providerAccountId,
        capability: 'appointment_request',
        type: window.rule.type,
        rule: window.rule,
        ruleFingerprint: fingerprint,
        status: 'active',
      },
    });
    createdIds.push(created.id);
  }

  return { createdIds, reusedIds };
}

export async function closeBookableWindow(
  client: AvailabilityClient,
  input: {
    providerAccountId: string;
    bookableWindowId: string;
    confirmCancelPending: boolean;
  },
): Promise<
  | { ok: true; cancelledPendingCount: number }
  | { ok: false; error: 'pending_requests_require_confirmation'; pendingCount: number }
> {
  const readPending = (readClient: Pick<AvailabilityClient, 'appointmentRequest'>) =>
    readClient.appointmentRequest.findMany({
      where: {
        providerAccountId: input.providerAccountId,
        bookableWindowId: input.bookableWindowId,
        status: 'pending_held',
      },
      select: { id: true },
    });

  if (!input.confirmCancelPending) {
    const pending = await readPending(client);
    if (pending.length > 0) {
      return {
        ok: false,
        error: 'pending_requests_require_confirmation',
        pendingCount: pending.length,
      };
    }
  }

  return runAvailabilityWrite(client, async (writeClient) => {
    const pending = await readPending(writeClient);
    if (pending.length > 0 && !input.confirmCancelPending) {
      return {
        ok: false,
        error: 'pending_requests_require_confirmation',
        pendingCount: pending.length,
      };
    }

    const closedAt = new Date();
    const closed = await writeClient.bookableWindow.updateMany({
      where: {
        id: input.bookableWindowId,
        providerAccountId: input.providerAccountId,
        status: 'active',
      },
      data: { status: 'closed', closedAt },
    });
    if (closed.count === 0) {
      throw new Error('bookable_window_not_found');
    }

    if (pending.length === 0) {
      return { ok: true, cancelledPendingCount: 0 };
    }

    const releasedAt = new Date();
    const released = await writeClient.appointmentRequest.updateMany({
      where: { id: { in: pending.map((item) => item.id) }, status: 'pending_held' },
      data: {
        status: 'released',
        releaseReason: 'cancelled_by_a',
        releasedAt,
      },
    });
    if (released.count !== pending.length) {
      throw new Error('appointment_state_conflict');
    }

    await writeClient.appointmentEvent.createMany({
      data: pending.map((request) => ({
        appointmentId: request.id,
        fromState: 'pending_held',
        toState: 'released',
        actorAccountId: input.providerAccountId,
        actorRole: 'provider',
        reason: 'cancelled_by_a',
      })),
    });

    return { ok: true, cancelledPendingCount: pending.length };
  });
}
