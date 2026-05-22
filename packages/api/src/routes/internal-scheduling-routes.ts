import type { Context } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  disableUserLink,
  getOrCreateActiveUserLink,
  resetUserLink,
} from '../scheduling/user-link-service.js';

type JsonRecord = Record<string, unknown>;

export const internalSchedulingRouter = new Hono();

function isAuthorized(header: string | undefined): boolean {
  const expected = process.env['CLAWSCALE_IDENTITY_API_KEY']?.trim();
  return Boolean(expected) && header === `Bearer ${expected}`;
}

async function readJsonObject(c: Context): Promise<JsonRecord | null> {
  try {
    const body = await c.req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function stringField(body: JsonRecord, key: string, fallback = ''): string {
  const value = body[key];
  return typeof value === 'string' ? value : fallback;
}

function schedulingErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'scheduling_failed';
}

function retiredAppointmentSchedulingTool(c: Context): Response {
  return c.json({ ok: false, error: 'appointment_scheduling_retired' }, 410);
}

function isRetiredAppointmentSchedulingTool(toolName: string): boolean {
  return (
    toolName === 'open_bookable_windows' ||
    toolName === 'confirm_bookable_windows' ||
    toolName === 'list_pending_requests' ||
    toolName === 'query_bookable_windows' ||
    toolName === 'request_appointment' ||
    toolName === 'confirm_appointment' ||
    toolName === 'reject_appointment' ||
    toolName === 'cancel_appointment' ||
    toolName === 'block_service_link' ||
    toolName === 'unblock_service_link' ||
    toolName === 'remove_service_link'
  );
}

async function runActiveUserLinkTool<T>(
  c: Context,
  body: JsonRecord,
  fn: (customerId: string) => Promise<T>,
): Promise<Response> {
  const customerId = stringField(body, 'customer_id').trim();
  if (!customerId) {
    return c.json({ ok: false, error: 'invalid_customer_id' }, 400);
  }

  try {
    const result = await fn(customerId);
    return c.json({ ok: true, data: result });
  } catch (error) {
    return c.json({ ok: false, error: schedulingErrorCode(error) }, 400);
  }
}

internalSchedulingRouter.post('/tools/:toolName', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const toolName = c.req.param('toolName');
  if (isRetiredAppointmentSchedulingTool(toolName)) {
    return retiredAppointmentSchedulingTool(c);
  }

  const body = await readJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  if (toolName === 'get_user_link') {
    return runActiveUserLinkTool(c, body, (customerId) =>
      getOrCreateActiveUserLink(db as never, {
        providerAccountId: customerId,
      }),
    );
  }
  if (toolName === 'reset_user_link') {
    return runActiveUserLinkTool(c, body, (customerId) =>
      resetUserLink(db as never, {
        providerAccountId: customerId,
      }),
    );
  }
  if (toolName === 'disable_user_link') {
    return runActiveUserLinkTool(c, body, (customerId) =>
      disableUserLink(db as never, {
        providerAccountId: customerId,
      }),
    );
  }
  return c.json({ ok: false, error: 'unknown_tool' }, 404);
});

internalSchedulingRouter.post('/notifications/retry', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  return retiredAppointmentSchedulingTool(c);
});
