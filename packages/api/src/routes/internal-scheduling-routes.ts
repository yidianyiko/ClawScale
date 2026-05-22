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

  const customerId = stringField(body, 'customer_id');

  if (toolName === 'get_user_link') {
    const result = await getOrCreateActiveUserLink(db as never, {
      providerAccountId: customerId,
    });
    return c.json({ ok: true, data: result });
  }
  if (toolName === 'reset_user_link') {
    const result = await resetUserLink(db as never, {
      providerAccountId: customerId,
    });
    return c.json({ ok: true, data: result });
  }
  if (toolName === 'disable_user_link') {
    const result = await disableUserLink(db as never, {
      providerAccountId: customerId,
    });
    return c.json({ ok: true, data: result });
  }
  return c.json({ ok: false, error: 'unknown_tool' }, 404);
});

internalSchedulingRouter.post('/notifications/retry', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  return retiredAppointmentSchedulingTool(c);
});
