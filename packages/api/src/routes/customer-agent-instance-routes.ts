import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  getRuntimeAgentInstance,
  resetRuntimeAgentInstance,
  updateRuntimeAgentInstance,
} from '../lib/agent-instance-runtime-client.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';

declare module 'hono' {
  interface ContextVariableMap {
    customerAgentInstanceAuth: CustomerSession;
  }
}

const textField = (max: number, min = 0) => z.string().trim().min(min).max(max).nullable().optional();

const statusSchema = z
  .object({
    place: z.string().trim().max(20).nullable().optional(),
    action: z.string().trim().max(20).nullable().optional(),
  })
  .strict()
  .nullable()
  .optional();

const booleanObjectSchema = z
  .object({
    enabled: z.boolean().nullable().optional(),
  })
  .strict()
  .nullable()
  .optional();

const agentInstancePatchSchema = z
  .object({
    display_name: textField(20, 1),
    nickname: textField(20, 1),
    user_address_name: textField(10, 1),
    persona: textField(2000),
    background: textField(4000),
    speaking_style: textField(1000),
    extra_rules: textField(1000),
    status: statusSchema,
    proactive: booleanObjectSchema,
    memory: booleanObjectSchema,
  })
  .strict();

export const customerAgentInstanceRouter = new Hono()
  .use('*', requireCustomerAgentInstanceAuth)
  .get('/', async (c) => {
    const auth = c.get('customerAgentInstanceAuth');
    const result = await getRuntimeAgentInstance({ customerId: auth.customerId });
    return runtimeResultResponse(c, result);
  })
  .patch('/', async (c) => {
    const body = await readJsonObject(c);
    if (!body) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const parsed = agentInstancePatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const auth = c.get('customerAgentInstanceAuth');
    const result = await updateRuntimeAgentInstance({
      customerId: auth.customerId,
      patch: parsed.data,
    });
    return runtimeResultResponse(c, result);
  })
  .post('/reset', async (c) => {
    const auth = c.get('customerAgentInstanceAuth');
    const result = await resetRuntimeAgentInstance({ customerId: auth.customerId });
    return runtimeResultResponse(c, result);
  });

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function requireCustomerAgentInstanceAuth(c: Context, next: Next): Promise<Response | void> {
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

    c.set('customerAgentInstanceAuth', session);
    await next();
    return;
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }
}

async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  try {
    const body = (await c.req.json()) as unknown;
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapRuntimeError(error: string): 400 | 404 | 503 | 502 {
  if (error === 'base_character_not_found') {
    return 404;
  }
  if (error === 'agent_instance_bridge_transport_failed' || error === 'agent_instance_bridge_invalid_response') {
    return 503;
  }
  if (error === 'invalid_body' || error === 'invalid_customer_id') {
    return 400;
  }
  return 502;
}

function runtimeResultResponse(
  c: Context,
  result: { ok: true; data: unknown } | { ok: false; error: string },
): Response {
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, mapRuntimeError(result.error));
  }
  return c.json({ ok: true, data: result.data });
}
