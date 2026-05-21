import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  claimLinkSession,
  createLinkSession,
  getLinkSessionStatus,
  readPublicUserLinkByCode,
} from '../scheduling/user-link-service.js';

export const publicUserLinkRouter = new Hono();
export const publicLinkSessionRouter = new Hono();

type JsonRecord = Record<string, unknown>;

async function readJsonObject(c: { req: { json(): Promise<unknown>; header(name: string): string | undefined } }): Promise<JsonRecord | null> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
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

publicUserLinkRouter.get('/:code', async (c) => {
  try {
    const result = await readPublicUserLinkByCode(db as never, {
      code: c.req.param('code'),
    });
    if (!result) {
      return c.json({ ok: false, error: 'link_not_active' }, 404);
    }
    return c.json({ ok: true, data: result });
  } catch {
    return c.json({ ok: false, error: 'link_not_active' }, 404);
  }
});

publicUserLinkRouter.post('/:code/sessions', async (c) => {
  try {
    const result = await createLinkSession(db as never, {
      code: c.req.param('code'),
    });
    return c.json({ ok: true, data: result }, 201);
  } catch {
    return c.json({ ok: false, error: 'link_not_active' }, 404);
  }
});

publicLinkSessionRouter.get('/:token/status', async (c) => {
  try {
    const result = await getLinkSessionStatus(db as never, {
      token: c.req.param('token'),
    });
    return c.json({ ok: true, data: result });
  } catch {
    return c.json({ ok: false, error: 'link_session_not_found' }, 404);
  }
});

publicLinkSessionRouter.post('/:token/claim', async (c) => {
  const body = await readJsonObject(c);
  if (!body) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    const result = await claimLinkSession(db as never, {
      token: c.req.param('token'),
      consumerAccountId: stringField(body, 'customer_id') || stringField(body, 'consumerAccountId'),
    });
    return c.json({ ok: true, data: result });
  } catch {
    return c.json({ ok: false, error: 'link_session_not_claimable' }, 400);
  }
});
