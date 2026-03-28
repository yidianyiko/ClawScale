import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { channelsRouter } from './routes/channels.js';
import { tenantRouter } from './routes/tenant.js';
import { workflowsRouter } from './routes/workflows.js';
import { conversationsRouter } from './routes/conversations.js';
import { gatewayRouter } from './gateway/message-router.js';
import { initDiscordAdapters } from './adapters/discord.js';
import { initWeChatAdapters } from './adapters/wechat.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(
  '*',
  cors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use('*', logger());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// ─── Dashboard API routes (internal members) ─────────────────────────────────

app.route('/auth', authRouter);
app.route('/api/users', usersRouter);
app.route('/api/channels', channelsRouter);
app.route('/api/tenant', tenantRouter);
app.route('/api/workflows', workflowsRouter);
app.route('/api/conversations', conversationsRouter);

// ─── Gateway (inbound messages from social channels) ─────────────────────────

app.route('/gateway', gatewayRouter);

// ─── Fallback ─────────────────────────────────────────────────────────────────

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
  initDiscordAdapters().catch((err) => console.error('[discord] Init failed:', err));
  initWeChatAdapters().catch((err) => console.error('[wechat] Init failed:', err));
});
