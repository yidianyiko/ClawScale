import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  createLinkSession,
  getLinkSessionStatus,
  readPublicUserLinkByCode,
} from '../scheduling/user-link-service.js';

export const publicUserLinkRouter = new Hono();
export const publicLinkSessionRouter = new Hono();

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
  return c.json({ ok: false, error: 'appointment_scheduling_retired' }, 410);
});
