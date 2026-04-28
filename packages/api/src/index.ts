import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { outboundRouter } from './routes/outbound.js';
import { cokeBindingsRouter } from './routes/coke-bindings.js';
import { cokeDeliveryRoutesRouter } from './routes/coke-delivery-routes.js';
import { cokeUserProvisionRouter } from './routes/coke-user-provision.js';
import { customerAuthRouter } from './routes/customer-auth-routes.js';
import { customerClaimRouter } from './routes/customer-claim-routes.js';
import { customerChannelRouter } from './routes/customer-channel-routes.js';
import { customerGoogleCalendarImportRouter } from './routes/customer-google-calendar-import-routes.js';
import { customerGoogleCalendarImportCallbackRouter } from './routes/customer-google-calendar-import-callback-routes.js';
import {
  customerCalendarImportHandoffRouter,
  internalCalendarImportHandoffRouter,
} from './routes/calendar-import-handoff-routes.js';
import { customerSubscriptionRouter } from './routes/customer-subscription-routes.js';
import { adminAuthRouter } from './routes/admin-auth-routes.js';
import { adminCustomersRouter } from './routes/admin-customers.js';
import { adminSharedChannelsRouter } from './routes/admin-shared-channels.js';
import { adminDeliveriesRouter } from './routes/admin-deliveries.js';
import { adminAdminsRouter } from './routes/admin-admins.js';
import { userWechatChannelRouter } from './routes/user-wechat-channel.js';
import { gatewayRouter } from './gateway/message-router.js';
import { initWeixinAdapters } from './adapters/wechat.js';
import { initBridgeWebSocket } from './gateway/bridge-ws.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(
  '*',
  cors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:4040',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use('*', logger());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// ─── Internal platform routes ────────────────────────────────────────────────

app.route('/api/internal/coke-bindings', cokeBindingsRouter);
app.route('/api/internal/coke-delivery', cokeDeliveryRoutesRouter);
app.route('/api/internal/coke-users/provision', cokeUserProvisionRouter);
app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);
app.route('/api/internal/calendar-import-handoffs', internalCalendarImportHandoffRouter);

// ─── Customer and admin routes ───────────────────────────────────────────────

app.route('/api/outbound', outboundRouter);
app.route('/api/auth', customerAuthRouter);
app.route('/api/auth/claim', customerClaimRouter);
app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportRouter);
app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);
app.route('/api/customer/calendar-import-handoffs', customerCalendarImportHandoffRouter);
app.route('/api/admin', adminAuthRouter);
app.route('/api/admin/customers', adminCustomersRouter);
app.route('/api/admin/shared-channels', adminSharedChannelsRouter);
app.route('/api/admin/deliveries', adminDeliveriesRouter);
app.route('/api/admin/admins', adminAdminsRouter);
app.route('/api', customerSubscriptionRouter);
app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

// ─── Gateway (inbound messages from social channels) ─────────────────────────

app.route('/gateway', gatewayRouter);

// ─── Fallback ─────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ ok: false, error: 'Internal server error' }, 500);
});

// ─── Start server ─────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] ?? '4041', 10);
const host = process.env['HOST'] ?? '0.0.0.0';

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`ClawScale API running on http://${info.address}:${info.port}`);
  initBridgeWebSocket(server);
  initWeixinAdapters().catch((err) => console.error('[weixin] Init failed:', err));
});
