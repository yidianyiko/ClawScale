/**
 * Message Router (HTTP gateway)
 *
 * Thin HTTP layer over routeInboundMessage(). All channel adapters call
 * routeInboundMessage() directly — these routes exist for webhook-based
 * platforms (LINE, Teams) that need HTTP signature verification before
 * the message can be handed off.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as lineSdk from '@line/bot-sdk';
import { routeInboundMessage } from '../lib/route-message.js';
import { getLineBot, handleLineEvents } from '../adapters/line.js';
import { getTeamsBot, handleTeamsActivity } from '../adapters/teams.js';
import { verifyWebhook, handleWABusinessWebhook, getWABusinessConfig } from '../adapters/whatsapp-business.js';

const inboundSchema = z.object({
  externalId:  z.string().min(1),
  displayName: z.string().optional(),
  text:        z.string().min(1),
  meta:        z.record(z.unknown()).default({}),
});

export const gatewayRouter = new Hono()

  // ── GET /gateway/whatsapp/:channelId ────────────────────────────────────────
  // Meta webhook verification — responds with hub.challenge.
  .get('/whatsapp/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    const mode = c.req.query('hub.mode') ?? '';
    const token = c.req.query('hub.verify_token') ?? '';
    const challenge = c.req.query('hub.challenge') ?? '';

    const result = await verifyWebhook(channelId, mode, token, challenge);
    if (result) return c.text(result, 200);
    return c.json({ ok: false, error: 'Verification failed' }, 403);
  })

  // ── POST /gateway/whatsapp/:channelId ───────────────────────────────────────
  // Meta sends inbound WhatsApp Business messages here.
  .post('/whatsapp/:channelId', async (c) => {
    const channelId = c.req.param('channelId');

    const body = await c.req.json();
    handleWABusinessWebhook(channelId, body).catch((err) =>
      console.error(`[wa-business:${channelId}] Webhook handling error:`, err),
    );

    // Always return 200 quickly so Meta doesn't retry
    return c.json({ ok: true });
  })

  // ── POST /gateway/line/:channelId ────────────────────────────────────────────
  // LINE webhook — verifies signature, then delegates to the LINE adapter.
  .post('/line/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    const bot = getLineBot(channelId);
    if (!bot) return c.json({ ok: false, error: 'Channel not found or not connected' }, 404);

    const signature = c.req.header('x-line-signature') ?? '';
    const body = await c.req.text();

    if (!lineSdk.validateSignature(body, bot.channelSecret, signature)) {
      return c.json({ ok: false, error: 'Invalid signature' }, 400);
    }

    const payload = JSON.parse(body) as { events: lineSdk.WebhookEvent[] };
    handleLineEvents(channelId, payload.events).catch((err) =>
      console.error(`[line:${channelId}] Event handling error:`, err),
    );

    return c.json({ ok: true });
  })

  // ── POST /gateway/teams/:channelId ───────────────────────────────────────────
  // Teams webhook — delegates to the Teams adapter for JWT verification + reply.
  .post('/teams/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    const bot = getTeamsBot(channelId);
    if (!bot) return c.json({ ok: false, error: 'Channel not found or not connected' }, 404);

    const activity = await c.req.json();
    handleTeamsActivity(channelId, activity).catch((err) =>
      console.error(`[teams:${channelId}] Activity handling error:`, err),
    );

    return c.json({ ok: true });
  })

  // ── POST /gateway/:channelId ─────────────────────────────────────────────────
  // Generic inbound endpoint — used by adapters that do their own event handling
  // but still want an HTTP interface (useful for testing / external integrations).
  .post('/:channelId', zValidator('json', inboundSchema), async (c) => {
    const channelId = c.req.param('channelId');
    const body = c.req.valid('json');

    const result = await routeInboundMessage({
      channelId,
      externalId:  body.externalId,
      displayName: body.displayName,
      text:        body.text,
      meta:        body.meta,
    });

    if (!result) return c.json({ ok: false, error: 'Message could not be routed' }, 400);
    return c.json({ ok: true, data: result });
  });
