import { Hono } from 'hono';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../db/index.js';
import {
  DeliveryRouteResolutionError,
  resolveExactDeliveryRoute,
} from '../lib/business-conversation.js';
import { deliverOutboundMessage } from '../lib/outbound-delivery.js';

const bodySchema = z.object({
  output_id: z.string().min(1),
  account_id: z.string().min(1),
  business_conversation_key: z.string().min(1),
  message_type: z.enum(['text']),
  text: z.string().min(1),
  delivery_mode: z.enum(['push', 'request_response']),
  expect_output_timestamp: z.string().min(1),
  idempotency_key: z.string().min(1),
  trace_id: z.string().min(1),
  causal_inbound_event_id: z.string().min(1).optional(),
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

function normalizePayload(body: z.infer<typeof bodySchema>): Prisma.InputJsonObject {
  return {
    output_id: body.output_id,
    account_id: body.account_id,
    business_conversation_key: body.business_conversation_key,
    message_type: body.message_type,
    text: body.text,
    delivery_mode: body.delivery_mode,
    expect_output_timestamp: body.expect_output_timestamp,
    idempotency_key: body.idempotency_key,
    trace_id: body.trace_id,
    ...(body.causal_inbound_event_id
      ? { causal_inbound_event_id: body.causal_inbound_event_id }
      : {}),
  };
}

function isMissingDeliveryRouteError(
  error: unknown,
): error is DeliveryRouteResolutionError | {
  code: 'missing_delivery_route';
  context?: { cokeAccountId?: string; businessConversationKey?: string };
} {
  if (error instanceof DeliveryRouteResolutionError) return true;
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'missing_delivery_route';
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
  const payload = normalizePayload(body);

  const handleExistingIdempotency = (
    existingDelivery: {
      id: string;
      status: string;
      payload: unknown;
    },
  ): { response: Response | null; shouldReclaimFailed: boolean } => {
    const existingPayload = JSON.stringify(existingDelivery.payload);
    const requestPayload = JSON.stringify(payload);
    if (existingPayload !== requestPayload) {
      return {
        response: c.json(
          {
            ok: false,
            error: 'idempotency_key_conflict',
            idempotency_key: body.idempotency_key,
          },
          409,
        ),
        shouldReclaimFailed: false,
      };
    }

    if (existingDelivery.status === 'failed') {
      return {
        response: null,
        shouldReclaimFailed: true,
      };
    }

    return {
      response: c.json(
        {
          ok: false,
          error:
            existingDelivery.status === 'succeeded'
              ? 'duplicate_request'
              : 'duplicate_request_in_progress',
          idempotency_key: body.idempotency_key,
        },
        409,
      ),
      shouldReclaimFailed: false,
    };
  };

  let outboundDelivery = await db.outboundDelivery.findUnique({
    where: {
      idempotencyKey: body.idempotency_key,
    },
  });
  let shouldReclaimFailed = false;

  if (outboundDelivery) {
    const existingResult = handleExistingIdempotency(outboundDelivery);
    if (existingResult.response) {
      return existingResult.response;
    }
    shouldReclaimFailed = existingResult.shouldReclaimFailed;
  }

  let deliveryRoute;
  let channel;
  if (!outboundDelivery) {
    try {
      deliveryRoute = await resolveExactDeliveryRoute({
        cokeAccountId: body.account_id,
        businessConversationKey: body.business_conversation_key,
      });
    } catch (error) {
      if (!isMissingDeliveryRouteError(error)) {
        throw error;
      }
      const context =
        error instanceof DeliveryRouteResolutionError
          ? error.context
          : (error.context ?? {
              cokeAccountId: body.account_id,
              businessConversationKey: body.business_conversation_key,
            });

      return c.json(
        {
          ok: false,
          error: 'missing_delivery_route',
          context: {
            coke_account_id: context.cokeAccountId,
            business_conversation_key: context.businessConversationKey,
          },
        },
        404,
      );
    }

    channel = await db.channel.findFirst({
      where: {
        id: deliveryRoute.channelId,
        tenantId: deliveryRoute.tenantId,
      },
    });
    if (!channel) {
      return c.json({ ok: false, error: 'channel_not_found' }, 404);
    }

    try {
      outboundDelivery = await db.outboundDelivery.create({
        data: {
          tenantId: deliveryRoute.tenantId,
          channelId: deliveryRoute.channelId,
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
          idempotencyKey: body.idempotency_key,
        },
      });

      if (!outboundDelivery) {
        throw error;
      }

      const existingResult = handleExistingIdempotency(outboundDelivery);
      if (existingResult.response) {
        return existingResult.response;
      }
      shouldReclaimFailed = existingResult.shouldReclaimFailed;
    }
  }

  if (!deliveryRoute) {
    try {
      deliveryRoute = await resolveExactDeliveryRoute({
        cokeAccountId: body.account_id,
        businessConversationKey: body.business_conversation_key,
      });
    } catch (error) {
      if (!isMissingDeliveryRouteError(error)) {
        throw error;
      }
      const context =
        error instanceof DeliveryRouteResolutionError
          ? error.context
          : (error.context ?? {
              cokeAccountId: body.account_id,
              businessConversationKey: body.business_conversation_key,
            });

      return c.json(
        {
          ok: false,
          error: 'missing_delivery_route',
          context: {
            coke_account_id: context.cokeAccountId,
            business_conversation_key: context.businessConversationKey,
          },
        },
        404,
      );
    }
  }

  if (!channel) {
    channel = await db.channel.findFirst({
      where: {
        id: deliveryRoute.channelId,
        tenantId: deliveryRoute.tenantId,
      },
    });
    if (!channel) {
      return c.json({ ok: false, error: 'channel_not_found' }, 404);
    }
  }

  if (shouldReclaimFailed) {
    const reclaimResult = await db.outboundDelivery.updateMany({
      where: {
        id: outboundDelivery.id,
        status: 'failed',
      },
      data: {
        status: 'pending',
        error: null,
      },
    });

    if (reclaimResult.count === 0) {
      return c.json(
        {
          ok: false,
          error: 'duplicate_request_in_progress',
          idempotency_key: body.idempotency_key,
        },
        409,
      );
    }
  }

  try {
    await deliverOutboundMessage(channel, deliveryRoute.externalEndUserId, body.text);
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
