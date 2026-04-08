import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { deliverOutboundMessage } from '../lib/outbound-delivery.js';


const bodySchema = z.object({
  tenant_id: z.string(),
  channel_id: z.string(),
  external_end_user_id: z.string().min(1).optional(),
  end_user_id: z.string().min(1).optional(),
  text: z.string().min(1),
  idempotency_key: z.string().min(1),
}).refine((body) => body.external_end_user_id ?? body.end_user_id, {
  message: 'One of external_end_user_id or end_user_id is required',
  path: ['external_end_user_id'],
});

export const outboundRouter = new Hono();

outboundRouter.post('/', async (c) => {
  const expected = process.env['CLAWSCALE_OUTBOUND_API_KEY'] ?? '';
  if (c.req.header('Authorization') !== `Bearer ${expected}`) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = bodySchema.parse(await c.req.json());
  const channel = await db.channel.findFirst({
    where: { id: body.channel_id, tenantId: body.tenant_id },
  });
  if (!channel) {
    return c.json({ ok: false, error: 'channel_not_found' }, 404);
  }

  // `external_end_user_id` is the forward-compatible canonical name.
  // `end_user_id` remains a compatibility alias during the transition.
  const externalEndUserId = body.external_end_user_id ?? body.end_user_id;

  await deliverOutboundMessage(channel, externalEndUserId, body.text);
  return c.json({ ok: true, idempotency_key: body.idempotency_key });
});
