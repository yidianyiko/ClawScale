import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  cancelRuntimeReminder,
  completeRuntimeReminder,
  createRuntimeReminder,
  listRuntimeReminders,
  updateRuntimeReminder,
} from '../lib/reminder-runtime-client.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';

declare module 'hono' {
  interface ContextVariableMap {
    customerReminderAuth: CustomerSession;
  }
}

const MAX_LIST_RANGE_DAYS_INCLUSIVE = 31;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^\d{2}:\d{2}$/;

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function requireCustomerReminderAuth(c: Context, next: Next): Promise<Response | void> {
  const token = readBearerToken(c);
  if (!token) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const payload = verifyCustomerToken(token);
    const session = await getCustomerSession(db as never, {
      customerId: payload.sub,
      identityId: payload.identityId,
    });

    if (!session) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    if (session.claimStatus !== 'active') {
      return c.json({ ok: false, error: 'claim_inactive' }, 403);
    }

    c.set('customerReminderAuth', session);
    await next();
    return;
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }
}

function parseIsoLocalDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !LOCAL_DATE_RE.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

function isValidLocalTime(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_TIME_RE.test(value)) {
    return false;
  }
  const [hourRaw, minuteRaw] = value.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isValidIanaTimezone(value: string): boolean {
  if (value === 'UTC') {
    return true;
  }
  if (value === 'Etc/UTC') {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  const supportedValuesOf = Intl.supportedValuesOf?.bind(Intl);
  if (supportedValuesOf) {
    return supportedValuesOf('timeZone').includes(value);
  }

  if (!value.includes('/') || /^[A-Z]{2,5}$/.test(value)) {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const localDateSchema = z
  .string()
  .regex(LOCAL_DATE_RE)
  .refine((value) => parseIsoLocalDate(value) !== null);

const localTimeSchema = z.string().regex(LOCAL_TIME_RE).refine(isValidLocalTime);

const nonEmptyStringSchema = z.string().trim().min(1);

const timezoneSchema = nonEmptyStringSchema.refine(isValidIanaTimezone);

const titleSchema = nonEmptyStringSchema.max(200);

const rruleSchema = z.union([z.literal('FREQ=DAILY'), z.literal('FREQ=WEEKLY'), z.null()]).optional();

const optionalHintSchema = z.preprocess(
  (value) => readNonEmptyString(value) ?? undefined,
  z.string().optional(),
);

const listQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    states: z.array(z.enum(['active', 'completed', 'cancelled', 'failed'])).min(1),
  })
  .superRefine((value, ctx) => {
    const fromDate = parseIsoLocalDate(value.from);
    const toDate = parseIsoLocalDate(value.to);
    if (!fromDate || !toDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom });
      return;
    }
    const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (rangeDays < 1 || rangeDays > MAX_LIST_RANGE_DAYS_INCLUSIVE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom });
    }
  });

const createReminderBodySchema = z.object({
  title: titleSchema,
  localDate: localDateSchema,
  localTime: localTimeSchema,
  timezone: timezoneSchema,
  rrule: rruleSchema,
  businessConversationKey: optionalHintSchema,
  gatewayConversationId: optionalHintSchema,
});

const updateReminderBodySchema = z
  .object({
    title: titleSchema.optional(),
    localDate: localDateSchema.optional(),
    localTime: localTimeSchema.optional(),
    timezone: timezoneSchema.optional(),
    rrule: rruleSchema,
  })
  .superRefine((value, ctx) => {
    const scheduleKeys: Array<keyof typeof value> = ['localDate', 'localTime', 'timezone', 'rrule'];
    const hasScheduleField = scheduleKeys.some((key) => key in value);
    if (!hasScheduleField) {
      return;
    }
    if (!value.localDate || !value.localTime || !value.timezone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom });
    }
  });

function readStates(url: URL): string[] {
  const rawValues = [...url.searchParams.getAll('states'), ...url.searchParams.getAll('state')];
  if (rawValues.length === 0) {
    return ['active'];
  }

  return rawValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseListQuery(c: Context):
  | { ok: true; from: string; to: string; states: string[] }
  | { ok: false; error: string } {
  const url = new URL(c.req.url);
  const parsed = listQuerySchema.safeParse({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    states: readStates(url),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_body' };
  }
  return { ok: true, from: parsed.data.from, to: parsed.data.to, states: [...new Set(parsed.data.states)] };
}

async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  try {
    const body = (await c.req.json()) as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapRuntimeError(error: string): 400 | 404 | 409 | 503 | 502 {
  if (error === 'reminder_not_found') {
    return 404;
  }
  if (error === 'conversation_required') {
    return 409;
  }
  if (error === 'reminder_bridge_transport_failed' || error === 'reminder_bridge_invalid_response') {
    return 503;
  }
  if (error === 'invalid_body' || error === 'invalid_schedule' || error === 'invalid_reminder') {
    return 400;
  }
  return 502;
}

function runtimeErrorResponse(c: Context, error: string): Response {
  return c.json({ ok: false, error }, mapRuntimeError(error));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeLocalTime(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return /^\d{2}:\d{2}:\d{2}$/.test(value) ? value.slice(0, 5) : value;
}

function mapReminderForBoard(reminder: Record<string, unknown>): Record<string, unknown> {
  const schedule = readRecord(reminder.schedule);
  return {
    ...reminder,
    localDate: readNonEmptyString(schedule?.localDate) ?? readNonEmptyString(reminder.localDate),
    localTime: normalizeLocalTime(schedule?.localTime) ?? normalizeLocalTime(reminder.localTime),
    timezone: readNonEmptyString(schedule?.timezone) ?? readNonEmptyString(reminder.timezone),
    rrule:
      schedule && 'rrule' in schedule
        ? schedule.rrule
        : 'rrule' in reminder
          ? reminder.rrule
          : null,
    schedule: undefined,
  };
}

export const customerReminderRouter = new Hono()
  .use('*', requireCustomerReminderAuth)
  .get('/', async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.ok) {
      return c.json({ ok: false, error: parsed.error }, 400);
    }

    const auth = c.get('customerReminderAuth');
    const result = await listRuntimeReminders({
      customerId: auth.customerId,
      from: parsed.from,
      to: parsed.to,
      states: parsed.states,
    });
    if (!result.ok) {
      return runtimeErrorResponse(c, result.error);
    }
    return c.json({
      ok: true,
      data: {
        reminders: result.data.map(mapReminderForBoard),
      },
    });
  })
  .post('/', async (c) => {
    const body = await readJsonObject(c);
    if (!body) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const parsed = createReminderBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const auth = c.get('customerReminderAuth');
    const result = await createRuntimeReminder({
      customerId: auth.customerId,
      title: parsed.data.title,
      localDate: parsed.data.localDate,
      localTime: parsed.data.localTime,
      timezone: parsed.data.timezone,
      ...(parsed.data.rrule !== undefined ? { rrule: parsed.data.rrule } : {}),
      ...(parsed.data.businessConversationKey
        ? { businessConversationKey: parsed.data.businessConversationKey }
        : {}),
      ...(parsed.data.gatewayConversationId
        ? { gatewayConversationId: parsed.data.gatewayConversationId }
        : {}),
    });
    if (!result.ok) {
      return runtimeErrorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data });
  })
  .patch('/:reminderId', async (c) => {
    const body = await readJsonObject(c);
    if (!body) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const parsed = updateReminderBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const auth = c.get('customerReminderAuth');
    const result = await updateRuntimeReminder({
      customerId: auth.customerId,
      reminderId: c.req.param('reminderId'),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.localDate !== undefined ? { localDate: parsed.data.localDate } : {}),
      ...(parsed.data.localTime !== undefined ? { localTime: parsed.data.localTime } : {}),
      ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
      ...(parsed.data.rrule !== undefined ? { rrule: parsed.data.rrule } : {}),
    });
    if (!result.ok) {
      return runtimeErrorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data });
  })
  .post('/:reminderId/complete', async (c) => {
    const auth = c.get('customerReminderAuth');
    const result = await completeRuntimeReminder({
      customerId: auth.customerId,
      reminderId: c.req.param('reminderId'),
    });
    if (!result.ok) {
      return runtimeErrorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data });
  })
  .post('/:reminderId/cancel', async (c) => {
    const auth = c.get('customerReminderAuth');
    const result = await cancelRuntimeReminder({
      customerId: auth.customerId,
      reminderId: c.req.param('reminderId'),
    });
    if (!result.ok) {
      return runtimeErrorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data });
  });
