import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { deliverOutboundMessage } from '../lib/outbound-delivery.js';


const bodySchema = z.object({
  tenant_id: z.string(),
  channel_id: z.string(),
  end_user_id: z.string(),
  text: z.string().min(1),
  idempotency_key: z.string().min(1),
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

  await deliverOutboundMessage(channel, body.end_user_id, body.text);
  return c.json({ ok: true, idempotency_key: body.idempotency_key });
});
