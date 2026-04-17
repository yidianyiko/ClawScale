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
  account_id: z.string().min(1).optional(),
  customer_id: z.string().min(1).optional(),
  business_conversation_key: z.string().min(1),
  message_type: z.enum(['text']),
  text: z.string().min(1),
  delivery_mode: z.enum(['push', 'request_response']),
  expect_output_timestamp: z.string().min(1),
  idempotency_key: z.string().min(1),
  trace_id: z.string().min(1),
  causal_inbound_event_id: z.string().min(1).optional(),
});

type RawOutboundBody = z.infer<typeof bodySchema>;
type NormalizedOutboundBody = RawOutboundBody & { customer_id: string };
type DeliveryRouteTarget = { channelId: string; externalEndUserId: string; tenantId: string };

export const outboundRouter = new Hono();

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function normalizeBody(body: RawOutboundBody): NormalizedOutboundBody | null {
  const customerId = body.customer_id?.trim() ?? body.account_id?.trim() ?? '';
  if (!customerId) return null;

  return {
    ...body,
    customer_id: customerId,
  };
}

function normalizeComparablePayload(body: NormalizedOutboundBody): Prisma.InputJsonObject {
  return {
    output_id: body.output_id,
    customer_id: body.customer_id,
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

function buildStoredPayload(
  body: NormalizedOutboundBody,
  target: Pick<DeliveryRouteTarget, 'channelId' | 'externalEndUserId'>,
): Prisma.InputJsonObject {
  return {
    ...normalizeComparablePayload(body),
    channel_id: target.channelId,
    external_end_user_id: target.externalEndUserId,
  };
}

function readComparablePayload(payload: unknown): Prisma.InputJsonObject {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const comparable: Prisma.InputJsonObject = {};
  for (const key of [
    'output_id',
    'customer_id',
    'business_conversation_key',
    'message_type',
    'text',
    'delivery_mode',
    'expect_output_timestamp',
    'idempotency_key',
    'trace_id',
    'causal_inbound_event_id',
  ]) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      comparable[key] = value;
    }
  }

  return comparable;
}

function readStoredTarget(
  payload: unknown,
  fallbackChannelId: string,
): Pick<DeliveryRouteTarget, 'channelId' | 'externalEndUserId'> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const channelId = typeof record.channel_id === 'string' && record.channel_id.trim()
    ? record.channel_id.trim()
    : fallbackChannelId;
  const externalEndUserId = typeof record.external_end_user_id === 'string' && record.external_end_user_id.trim()
    ? record.external_end_user_id.trim()
    : '';

  if (!channelId || !externalEndUserId) {
    return null;
  }

  return { channelId, externalEndUserId };
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

  const body = normalizeBody(parsed.data);
  if (!body) {
    return c.json(
      {
        ok: false,
        error: 'validation_error',
      },
      400,
    );
  }

  const comparablePayload = normalizeComparablePayload(body);

  const handleExistingIdempotency = (
    existingDelivery: {
      id: string;
      status: string;
      payload: unknown;
    },
  ): { response: Response | null; shouldReclaimFailed: boolean } => {
    const existingPayload = JSON.stringify(readComparablePayload(existingDelivery.payload));
    const requestPayload = JSON.stringify(comparablePayload);
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

  let deliveryRoute: DeliveryRouteTarget | undefined;
  let channel;
  let deliveryTarget: Pick<DeliveryRouteTarget, 'channelId' | 'externalEndUserId'> | undefined;
  if (!outboundDelivery) {
    try {
      deliveryRoute = await resolveExactDeliveryRoute({
        cokeAccountId: body.customer_id,
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
              cokeAccountId: body.customer_id,
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

    deliveryTarget = {
      channelId: deliveryRoute.channelId,
      externalEndUserId: deliveryRoute.externalEndUserId,
    };

    channel = await db.channel.findFirst({
      where: {
        id: deliveryTarget.channelId,
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
          channelId: deliveryTarget.channelId,
          idempotencyKey: body.idempotency_key,
          payload: buildStoredPayload(body, deliveryTarget),
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

  if (outboundDelivery && shouldReclaimFailed) {
    // Preserve the exact delivery target from the original resolution; failed reclaims
    // must not reroute to a different channel or peer.
    deliveryTarget = readStoredTarget(outboundDelivery.payload, outboundDelivery.channelId);
    if (!deliveryTarget) {
      return c.json({ ok: false, error: 'stored_delivery_target_missing' }, 409);
    }

    channel = await db.channel.findFirst({
      where: {
        id: deliveryTarget.channelId,
        tenantId: outboundDelivery.tenantId,
      },
    });
    if (!channel) {
      return c.json({ ok: false, error: 'channel_not_found' }, 404);
    }
  }

  if (!channel) {
    return c.json({ ok: false, error: 'channel_not_found' }, 404);
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
    await deliverOutboundMessage(channel, deliveryTarget?.externalEndUserId ?? deliveryRoute!.externalEndUserId, body.text);
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
