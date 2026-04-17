import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { AdminAuthError, authenticateAdmin } from '../lib/admin-auth.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

function mapAdminAuthError(error: unknown): {
  status: 401 | 403;
  body: { ok: false; error: string };
} {
  if (!(error instanceof AdminAuthError)) {
    throw error;
  }

  switch (error.code) {
    case 'invalid_credentials':
      return { status: 401, body: { ok: false, error: error.code } };
    case 'inactive_account':
      return { status: 403, body: { ok: false, error: error.code } };
  }
}

export const adminAuthRouter = new Hono()
  .post('/login', zValidator('json', loginSchema), async (c) => {
    try {
      const result = await authenticateAdmin(db as never, c.req.valid('json'));
      return c.json({ ok: true, data: result });
    } catch (error) {
      const failure = mapAdminAuthError(error);
      return c.json(failure.body, failure.status);
    }
  })
  // JWT auth is stateless here; logout only acknowledges client-side token discard.
  .post('/logout', requireAdminAuth, async (c) => {
    c.status(200);
    return c.json({ ok: true, data: null });
  })
  .get('/session', requireAdminAuth, async (c) => {
    return c.json({ ok: true, data: c.get('adminAuth') });
  });
