import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { channelsRouter } from './routes/channels.js';
import { tenantRouter } from './routes/tenant.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(
  '*',
  cors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use('*', logger());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route('/auth', authRouter);
app.route('/api/users', usersRouter);
app.route('/api/channels', channelsRouter);
app.route('/api/tenant', tenantRouter);

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ ok: false, error: 'Internal server error' }, 500);
});

// ─── Start server ─────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] ?? '3001', 10);
const host = process.env['HOST'] ?? '0.0.0.0';

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`ClawScale API running on http://${info.address}:${info.port}`);
});
