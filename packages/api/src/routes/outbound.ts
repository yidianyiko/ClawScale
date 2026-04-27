import { Hono } from 'hono';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../db/index.js';
import {
  DeliveryRouteResolutionError,
  resolveExactDeliveryRoute,
} from '../lib/business-conversation.js';
import { deliverOutboundMessage } from '../lib/outbound-delivery.js';

const messageTypeSchema = z.enum(['text', 'image', 'voice']);
const mediaUrlSchema = z.string().trim().url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}, 'media URL must be absolute http(s)');

const bodySchema = z.object({
  output_id: z.string().min(1),
  account_id: z.string().min(1).optional(),
  customer_id: z.string().min(1).optional(),
  business_conversation_key: z.string().min(1),
  message_type: messageTypeSchema,
  text: z.string().optional(),
  mediaUrls: z.array(mediaUrlSchema).optional(),
  audioAsVoice: z.boolean().optional(),
  delivery_mode: z.enum(['push', 'request_response']),
  expect_output_timestamp: z.string().min(1),
  idempotency_key: z.string().min(1),
  trace_id: z.string().min(1),
  causal_inbound_event_id: z.string().min(1).optional(),
}).superRefine((body, ctx) => {
  const text = body.text?.trim() ?? '';
  const mediaUrls = body.mediaUrls ?? [];

  if (!text && mediaUrls.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['text'],
      message: 'text or mediaUrls is required',
    });
  }

  if ((body.message_type === 'image' || body.message_type === 'voice') && mediaUrls.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mediaUrls'],
      message: `${body.message_type} requires mediaUrls`,
    });
  }

  if (body.message_type === 'voice' && body.audioAsVoice === false) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['audioAsVoice'],
      message: 'voice requires audioAsVoice',
    });
  }

  if (body.message_type !== 'voice' && body.audioAsVoice === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['audioAsVoice'],
      message: 'audioAsVoice is only valid for voice',
    });
  }
});

type RawOutboundBody = z.infer<typeof bodySchema>;
type NormalizedOutboundBody = RawOutboundBody & {
  customer_id: string;
  text: string;
  mediaUrls: string[];
  audioAsVoice: boolean;
};
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
    text: body.text ?? '',
    mediaUrls: body.mediaUrls ?? [],
    audioAsVoice: body.message_type === 'voice' ? true : (body.audioAsVoice ?? false),
  };
}

function normalizeComparablePayload(body: NormalizedOutboundBody): Prisma.InputJsonObject {
  return {
    output_id: body.output_id,
    customer_id: body.customer_id,
    business_conversation_key: body.business_conversation_key,
    message_type: body.message_type,
    text: body.text,
    mediaUrls: body.mediaUrls,
    audioAsVoice: body.audioAsVoice,
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
  const readRequiredString = (key: string, options?: { allowEmpty?: boolean }): string | undefined => {
    const value = record[key];
    if (typeof value !== 'string') return undefined;
    if (!options?.allowEmpty && value.length === 0) return undefined;
    return value;
  };

  const outputId = readRequiredString('output_id');
  const customerId = readRequiredString('customer_id');
  const businessConversationKey = readRequiredString('business_conversation_key');
  const messageType = readRequiredString('message_type');
  const text = readRequiredString('text', { allowEmpty: true });
  const deliveryMode = readRequiredString('delivery_mode');
  const expectOutputTimestamp = readRequiredString('expect_output_timestamp');
  const idempotencyKey = readRequiredString('idempotency_key');
  const traceId = readRequiredString('trace_id');

  if (
    !outputId ||
    !customerId ||
    !businessConversationKey ||
    (messageType !== 'text' && messageType !== 'image' && messageType !== 'voice') ||
    text === undefined ||
    !deliveryMode ||
    !expectOutputTimestamp ||
    !idempotencyKey ||
    !traceId
  ) {
    return {};
  }

  const mediaUrls = record['mediaUrls'];
  let normalizedMediaUrls: string[];
  if (Array.isArray(mediaUrls) && mediaUrls.every((value) => typeof value === 'string')) {
    normalizedMediaUrls = mediaUrls;
  } else if (mediaUrls === undefined && messageType === 'text') {
    normalizedMediaUrls = [];
  } else {
    return {};
  }

  const audioAsVoice = record['audioAsVoice'];
  let normalizedAudioAsVoice: boolean;
  if (typeof audioAsVoice === 'boolean') {
    normalizedAudioAsVoice = audioAsVoice;
  } else if (audioAsVoice === undefined && messageType === 'text') {
    normalizedAudioAsVoice = false;
  } else {
    return {};
  }

  if (!text.trim() && normalizedMediaUrls.length === 0) {
    return {};
  }

  if ((messageType === 'image' || messageType === 'voice') && normalizedMediaUrls.length === 0) {
    return {};
  }

  if (messageType === 'voice' && normalizedAudioAsVoice !== true) {
    return {};
  }

  if (messageType !== 'voice' && normalizedAudioAsVoice !== false) {
    return {};
  }

  const hasCausalInboundEventId = Object.prototype.hasOwnProperty.call(record, 'causal_inbound_event_id');
  const causalInboundEventId = record['causal_inbound_event_id'];
  if (
    hasCausalInboundEventId &&
    (typeof causalInboundEventId !== 'string' || causalInboundEventId.length === 0)
  ) {
    return {};
  }

  return {
    output_id: outputId,
    customer_id: customerId,
    business_conversation_key: businessConversationKey,
    message_type: messageType,
    text,
    mediaUrls: normalizedMediaUrls,
    audioAsVoice: normalizedAudioAsVoice,
    delivery_mode: deliveryMode,
    expect_output_timestamp: expectOutputTimestamp,
    idempotency_key: idempotencyKey,
    trace_id: traceId,
    ...(hasCausalInboundEventId
      ? { causal_inbound_event_id: causalInboundEventId }
      : {}),
  } as Prisma.InputJsonObject;
}

function readStoredTarget(
  payload: unknown,
  fallbackChannelId: string,
): Pick<DeliveryRouteTarget, 'channelId' | 'externalEndUserId'> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const channelId = typeof record.channel_id === 'string' && record.channel_id.trim()
    ? record.channel_id.trim()
    : fallbackChannelId;
  const externalEndUserId = typeof record.external_end_user_id === 'string' && record.external_end_user_id.trim()
    ? record.external_end_user_id.trim()
    : '';

  if (!channelId || !externalEndUserId) {
    return undefined;
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
    await deliverOutboundMessage(
      channel,
      deliveryTarget?.externalEndUserId ?? deliveryRoute!.externalEndUserId,
      {
        text: body.text,
        messageType: body.message_type,
        mediaUrls: body.mediaUrls,
        audioAsVoice: body.audioAsVoice,
      },
    );
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
