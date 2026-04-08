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
});

export const outboundRouter = new Hono();

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

outboundRouter.post('/', async (c) => {
  const expected = process.env['CLAWSCALE_OUTBOUND_API_KEY'] ?? '';
  if (c.req.header('Authorization') !== `Bearer ${expected}`) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: 'validation_error',
        issues: parsed.error.issues,
      },
      400,
    );
  }

  const body = parsed.data;
  const externalEndUserId = body.external_end_user_id ?? body.end_user_id;
  if (!externalEndUserId) {
    return c.json(
      {
        ok: false,
        error: 'validation_error',
        issues: [
          {
            code: 'custom',
            message: 'One of external_end_user_id or end_user_id is required',
            path: ['external_end_user_id'],
          },
        ],
      },
      400,
    );
  }

  if (
    body.external_end_user_id &&
    body.end_user_id &&
    body.external_end_user_id !== body.end_user_id
  ) {
    return c.json(
      {
        ok: false,
        error: 'validation_error',
        issues: [
          {
            code: 'custom',
            message:
              'external_end_user_id and end_user_id must match when both are provided',
            path: ['external_end_user_id'],
          },
        ],
      },
      400,
    );
  }

  const channel = await db.channel.findFirst({
    where: { id: body.channel_id, tenantId: body.tenant_id },
  });
  if (!channel) {
    return c.json({ ok: false, error: 'channel_not_found' }, 404);
  }

  const payload = {
    external_end_user_id: externalEndUserId,
    text: body.text,
  };

  let outboundDelivery;
  try {
    outboundDelivery = await db.outboundDelivery.create({
      data: {
        tenantId: body.tenant_id,
        channelId: body.channel_id,
        idempotencyKey: body.idempotency_key,
        payload,
        status: 'pending',
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    outboundDelivery = await db.outboundDelivery.findUnique({
      where: {
        tenantId_channelId_idempotencyKey: {
          tenantId: body.tenant_id,
          channelId: body.channel_id,
          idempotencyKey: body.idempotency_key,
        },
      },
    });

    if (!outboundDelivery) {
      throw error;
    }

    const existingPayload = JSON.stringify(outboundDelivery.payload);
    const requestPayload = JSON.stringify(payload);
    if (existingPayload !== requestPayload) {
      return c.json(
        {
          ok: false,
          error: 'idempotency_key_conflict',
          idempotency_key: body.idempotency_key,
        },
        409,
      );
    }

    if (outboundDelivery.status === 'failed') {
      await db.outboundDelivery.update({
        where: { id: outboundDelivery.id },
        data: {
          status: 'pending',
          error: null,
        },
      });
    } else {
      return c.json(
        {
          ok: false,
          error:
            outboundDelivery.status === 'succeeded'
              ? 'duplicate_request'
              : 'duplicate_request_in_progress',
          idempotency_key: body.idempotency_key,
        },
        409,
      );
    }
  }

  // `external_end_user_id` is the forward-compatible canonical name.
  // `end_user_id` remains a compatibility alias during the transition.
  try {
    await deliverOutboundMessage(channel, externalEndUserId, body.text);
  } catch (error) {
    await db.outboundDelivery.update({
      where: { id: outboundDelivery.id },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      },
    });
    throw error;
  }

  await db.outboundDelivery.update({
    where: { id: outboundDelivery.id },
    data: {
      status: 'succeeded',
      error: null,
    },
  });

  return c.json({ ok: true, idempotency_key: body.idempotency_key });
});
