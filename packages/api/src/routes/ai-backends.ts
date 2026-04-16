import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';

const MOVED_TO_AGENT_STORAGE = {
  ok: false as const,
  error: 'moved_to_agent_storage' as const,
};

const GONE_STATUS = 410;

export const aiBackendsRouter = new Hono()
  .use('*', requireAuth)
  .all('*', (c) => c.json(MOVED_TO_AGENT_STORAGE, GONE_STATUS));
