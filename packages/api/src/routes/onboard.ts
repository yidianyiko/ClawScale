import { Hono } from 'hono';
import { db } from '../db/index.js';

const onboardRouter = new Hono();

/**
 * GET /api/onboard/channels?tenantSlug=xxx
 * Public endpoint — returns active channels with their public connect info.
 */
onboardRouter.get('/channels', async (c) => {
  const tenantSlug = c.req.query('tenantSlug');
  if (!tenantSlug) {
    return c.json({ error: 'tenantSlug is required' }, 400);
  }

  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true },
  });

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const channels = await db.channel.findMany({
    where: { tenantId: tenant.id, status: 'connected' },
    select: {
      id: true,
      type: true,
      name: true,
      config: true,
    },
  });

  // Extract only public connect info from each channel's config
  const publicChannels = channels.map((ch) => {
    const cfg = (ch.config ?? {}) as Record<string, unknown>;
    return {
      id: ch.id,
      type: ch.type,
      name: ch.name,
      connectUrl: cfg.connectUrl ?? cfg.botInviteUrl ?? cfg.botLink ?? null,
    };
  });

  return c.json({ tenantName: tenant.name, channels: publicChannels });
});

export { onboardRouter };
