import { createHash, createHmac } from 'node:crypto';
import type { BookableWindowRule, GeneratedWindowInstance } from './types.js';

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^\d{2}:\d{2}$/;
const MIN_DURATION_MINUTES = 15;
const MIN_DURATION_MS = MIN_DURATION_MINUTES * 60 * 1000;
const MAX_LOOKAHEAD_DAYS = 90;
const DEV_INSTANCE_SECRET = 'dev-scheduling-instance-secret';

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
}

function assertLocalDate(value: unknown, code = 'invalid_date'): string {
  if (typeof value !== 'string' || !LOCAL_DATE_RE.test(value)) throw new Error(code);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(code);
  return value;
}

function parseLocalDate(value: string): LocalDateParts {
  assertLocalDate(value);
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function parseLocalTime(value: string): { hour: number; minute: number; totalMinutes: number } {
  if (!LOCAL_TIME_RE.test(value)) throw new Error('invalid_time');
  const [hour, minute] = value.split(':').map(Number) as [number, number];
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error('invalid_time');
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

function validateWindowTimes(timeStart: string, timeEnd: string): void {
  const start = parseLocalTime(timeStart).totalMinutes;
  const end = parseLocalTime(timeEnd).totalMinutes;
  if (end <= start) throw new Error('window_overlap');
  if (end - start < MIN_DURATION_MINUTES) throw new Error('window_too_short');
}

export function isValidIanaTimezone(value: string): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (value === 'UTC') return true;

  const supportedValuesOf = Intl.supportedValuesOf?.bind(Intl);
  if (supportedValuesOf) {
    return supportedValuesOf('timeZone').includes(value);
  }

  if (!value.includes('/') || /^[A-Z]{2,5}$/.test(value) || value.startsWith('Etc/GMT')) {
    return false;
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: value });
    return formatter.resolvedOptions().timeZone === value;
  } catch {
    return false;
  }
}

export function validateBookableWindowRule(raw: unknown): BookableWindowRule {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('invalid_rule');
  const value = raw as Record<string, unknown>;
  const type = value.type;
  const timeStart = typeof value.time_start === 'string' ? value.time_start : '';
  const timeEnd = typeof value.time_end === 'string' ? value.time_end : '';
  const timezone = typeof value.timezone === 'string' ? value.timezone : '';

  if (!isValidIanaTimezone(timezone)) throw new Error('invalid_timezone');
  validateWindowTimes(timeStart, timeEnd);

  if (type === 'weekly') {
    const days = Array.isArray(value.days_of_week) ? value.days_of_week : [];
    if (
      days.length === 0 ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      throw new Error('invalid_weekday');
    }
    const effectiveFrom = assertLocalDate(value.effective_from);
    const effectiveUntil =
      value.effective_until === null ? null : assertLocalDate(value.effective_until);
    if (effectiveUntil !== null && effectiveUntil < effectiveFrom) throw new Error('invalid_date_range');

    return {
      type: 'weekly',
      days_of_week: [...new Set(days as number[])].sort((a, b) => a - b),
      time_start: timeStart,
      time_end: timeEnd,
      timezone,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil,
    };
  }

  if (type === 'once') {
    return {
      type: 'once',
      date: assertLocalDate(value.date),
      time_start: timeStart,
      time_end: timeEnd,
      timezone,
    };
  }

  throw new Error('invalid_rule_type');
}

export function buildRuleFingerprint(rule: BookableWindowRule): string {
  return createHash('sha256').update(JSON.stringify(rule)).digest('hex');
}

export function capQueryRange(dateFrom: string, dateTo?: string): { dateFrom: string; dateTo: string } {
  const start = new Date(`${assertLocalDate(dateFrom)}T00:00:00.000Z`);
  const requestedEnd = dateTo
    ? new Date(`${assertLocalDate(dateTo)}T00:00:00.000Z`)
    : new Date(start);
  if (!dateTo) requestedEnd.setUTCDate(requestedEnd.getUTCDate() + 14);
  if (requestedEnd < start) throw new Error('invalid_date_range');

  const maxEnd = new Date(start);
  maxEnd.setUTCDate(maxEnd.getUTCDate() + MAX_LOOKAHEAD_DAYS);
  const end = requestedEnd > maxEnd ? maxEnd : requestedEnd;
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

function localDateEpoch(parts: LocalDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function zonedParts(date: Date, timezone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const byType = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(byType.get('year')),
    month: Number(byType.get('month')),
    day: Number(byType.get('day')),
    hour: Number(byType.get('hour')),
    minute: Number(byType.get('minute')),
  };
}

function utcDateForLocal(date: string, time: string, timezone: string): Date {
  const localDate = parseLocalDate(date);
  const localTime = parseLocalTime(time);
  const targetParts: LocalDateTimeParts = {
    ...localDate,
    hour: localTime.hour,
    minute: localTime.minute,
  };
  const targetEpoch = localDateEpoch(targetParts);
  let utc = new Date(targetEpoch);

  for (let i = 0; i < 3; i += 1) {
    const currentLocalEpoch = localDateEpoch(zonedParts(utc, timezone));
    const delta = targetEpoch - currentLocalEpoch;
    if (delta === 0) return utc;
    utc = new Date(utc.getTime() + delta);
  }

  const finalParts = zonedParts(utc, timezone);
  if (localDateEpoch(finalParts) !== targetEpoch) throw new Error('invalid_local_time');
  return utc;
}

export function encodeWindowInstanceId(input: {
  bookableWindowId: string;
  instanceStart: string;
  instanceEnd: string;
}): string {
  const payload = `${input.bookableWindowId}|${input.instanceStart}|${input.instanceEnd}`;
  const secret = process.env['SCHEDULING_INSTANCE_SECRET'] || DEV_INSTANCE_SECRET;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16);
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function addDays(date: string, days: number): string {
  const value = new Date(`${assertLocalDate(date)}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekdayForLocalDate(date: string): number {
  const weekday = new Date(`${assertLocalDate(date)}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function shouldGenerateForDate(rule: BookableWindowRule, date: string): boolean {
  if (rule.type === 'once') return date === rule.date;
  if (!rule.days_of_week.includes(weekdayForLocalDate(date))) return false;
  if (date < rule.effective_from) return false;
  if (rule.effective_until !== null && date > rule.effective_until) return false;
  return true;
}

export function generateWindowInstances(input: {
  bookableWindowId: string;
  rule: BookableWindowRule;
  dateFrom: string;
  dateTo: string;
  excluded: Array<{ instanceStart: string; instanceEnd: string }>;
  occupied: Array<{ instanceStart: string; instanceEnd: string }>;
}): GeneratedWindowInstance[] {
  const range = capQueryRange(input.dateFrom, input.dateTo);
  const blocked = new Set(
    [...input.excluded, ...input.occupied].map((item) => `${item.instanceStart}|${item.instanceEnd}`),
  );
  const out: GeneratedWindowInstance[] = [];

  for (let date = range.dateFrom; date <= range.dateTo; date = addDays(date, 1)) {
    if (!shouldGenerateForDate(input.rule, date)) continue;

    const instanceStart = utcDateForLocal(date, input.rule.time_start, input.rule.timezone).toISOString();
    const instanceEnd = utcDateForLocal(date, input.rule.time_end, input.rule.timezone).toISOString();
    if (new Date(instanceEnd).getTime() - new Date(instanceStart).getTime() < MIN_DURATION_MS) continue;
    if (blocked.has(`${instanceStart}|${instanceEnd}`)) continue;

    out.push({
      windowInstanceId: encodeWindowInstanceId({
        bookableWindowId: input.bookableWindowId,
        instanceStart,
        instanceEnd,
      }),
      bookableWindowId: input.bookableWindowId,
      instanceStart,
      instanceEnd,
      providerTimezone: input.rule.timezone,
    });
  }

  return out;
}

export function renderWindowForViewer(instance: GeneratedWindowInstance, viewerTimezone: string) {
  if (!isValidIanaTimezone(viewerTimezone)) throw new Error('invalid_timezone');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: viewerTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'longGeneric',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(instance.instanceStart));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    localDate: `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`,
    localTime: `${byType.get('hour')}:${byType.get('minute')}`,
    timezoneLabel: byType.get('timeZoneName') || viewerTimezone,
  };
}
