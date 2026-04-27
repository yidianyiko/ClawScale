import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db/index.js', () => ({
  db: {
    channel: {
      findFirst: vi.fn(),
    },
    outboundDelivery: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/business-conversation.js', () => ({
  DeliveryRouteResolutionError: class DeliveryRouteResolutionError extends Error {
    code: 'missing_delivery_route';
    context: { cokeAccountId: string; businessConversationKey: string };

    constructor(
      code: 'missing_delivery_route',
      context: { cokeAccountId: string; businessConversationKey: string },
    ) {
      super('missing route');
      this.name = 'DeliveryRouteResolutionError';
      this.code = code;
      this.context = context;
    }
  },
  resolveExactDeliveryRoute: vi.fn(),
}));

vi.mock('../lib/outbound-delivery.js', () => ({
  deliverOutboundMessage: vi.fn(),
}));

import { db } from '../db/index.js';
import { resolveExactDeliveryRoute } from '../lib/business-conversation.js';
import { deliverOutboundMessage } from '../lib/outbound-delivery.js';
import { outboundRouter } from './outbound.js';

interface OutboundBody {
  output_id: string;
  account_id?: string;
  customer_id?: string;
  business_conversation_key: string;
  message_type: string;
  text?: string;
  mediaUrls?: string[];
  audioAsVoice?: boolean;
  delivery_mode: string;
  expect_output_timestamp: string;
  idempotency_key: string;
  trace_id: string;
  causal_inbound_event_id?: string;
}

const resolvedRoute = {
  tenantId: 'ten_1',
  cokeAccountId: 'acct_1',
  businessConversationKey: 'biz_conv_1',
  channelId: 'ch_1',
  endUserId: 'eu_1',
  externalEndUserId: 'wxid_1',
  isActive: true,
};

const channel = {
  id: 'ch_1',
  tenantId: 'ten_1',
  type: 'wechat_personal',
};

const movedRoute = {
  ...resolvedRoute,
  channelId: 'ch_2',
  externalEndUserId: 'wxid_2',
};

const movedChannel = {
  id: 'ch_2',
  tenantId: 'ten_1',
  type: 'wechat_personal',
};

function makeApp() {
  const app = new Hono();
  app.route('/api/outbound', outboundRouter);
  return app;
}

function makeBody(overrides?: Partial<OutboundBody>): OutboundBody {
  return {
    output_id: 'out_1',
    account_id: 'acct_1',
    business_conversation_key: 'biz_conv_1',
    message_type: 'text',
    text: 'hello',
    delivery_mode: 'push',
    expect_output_timestamp: '2026-04-09T10:00:00.000Z',
    idempotency_key: 'idem_1',
    trace_id: 'trace_1',
    ...overrides,
  };
}

function normalizePayload(body: OutboundBody): Record<string, string | boolean | string[]> {
  const normalizedCustomerId = body.customer_id ?? body.account_id ?? '';
  const payload: Record<string, string | boolean | string[]> = {
    output_id: body.output_id,
    customer_id: normalizedCustomerId,
    business_conversation_key: body.business_conversation_key,
    message_type: body.message_type,
    text: body.text ?? '',
    mediaUrls: body.mediaUrls ?? [],
    audioAsVoice: body.message_type === 'voice' ? true : (body.audioAsVoice ?? false),
    delivery_mode: body.delivery_mode,
    expect_output_timestamp: body.expect_output_timestamp,
    idempotency_key: body.idempotency_key,
    trace_id: body.trace_id,
  };
  if (body.causal_inbound_event_id) {
    payload.causal_inbound_event_id = body.causal_inbound_event_id;
  }
  return payload;
}

async function postOutbound(body: unknown) {
  const app = makeApp();
  return app.request('/api/outbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer secret',
    },
    body: JSON.stringify(body),
  });
}

describe('outbound router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAWSCALE_OUTBOUND_API_KEY = 'secret';
    vi.mocked(resolveExactDeliveryRoute).mockResolvedValue(resolvedRoute as never);
    vi.mocked(db.channel.findFirst).mockResolvedValue(channel as never);
    vi.mocked(db.outboundDelivery.create).mockResolvedValue({ id: 'outbound_1' } as never);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.outboundDelivery.update).mockResolvedValue({ id: 'outbound_1' } as never);
    vi.mocked(db.outboundDelivery.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(deliverOutboundMessage).mockResolvedValue(undefined as never);
  });

  it('rejects invalid bearer tokens', async () => {
    const app = makeApp();

    const res = await app.request('/api/outbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: JSON.stringify(makeBody()),
    });

    expect(res.status).toBe(401);
  });

  it('rejects unsupported message_type values', async () => {
    const res = await postOutbound(
      makeBody({
        message_type: 'video',
      }),
    );

    expect(res.status).toBe(400);
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('rejects unsupported delivery_mode values', async () => {
    const res = await postOutbound(
      makeBody({
        delivery_mode: 'scheduled',
      }),
    );

    expect(res.status).toBe(400);
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('returns structured missing_delivery_route when exact route is absent', async () => {
    vi.mocked(resolveExactDeliveryRoute).mockRejectedValueOnce({
      name: 'DeliveryRouteResolutionError',
      code: 'missing_delivery_route',
      context: {
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_missing',
      },
    });

    const res = await postOutbound(
      makeBody({
        business_conversation_key: 'biz_missing',
      }),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'missing_delivery_route',
      context: {
        coke_account_id: 'acct_1',
        business_conversation_key: 'biz_missing',
      },
    });
    expect(db.outboundDelivery.create).not.toHaveBeenCalled();
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('returns duplicate for succeeded idempotency record even when current route lookup would fail', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValueOnce({
      id: 'outbound_1',
      status: 'succeeded',
      payload: normalizePayload(body),
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);
    vi.mocked(resolveExactDeliveryRoute).mockImplementation(async () => {
      throw {
        name: 'DeliveryRouteResolutionError',
        code: 'missing_delivery_route',
        context: {
          cokeAccountId: 'acct_1',
          businessConversationKey: 'biz_conv_1',
        },
      };
    });

    const res = await postOutbound(body);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_request',
      idempotency_key: 'idem_1',
    });
    expect(resolveExactDeliveryRoute).not.toHaveBeenCalled();
    expect(db.outboundDelivery.create).not.toHaveBeenCalled();
  });

  it('does not reclaim failed key when the stored delivery target is missing, preventing pending wedge on retries', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: normalizePayload(body),
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);
    vi.mocked(resolveExactDeliveryRoute).mockRejectedValue({
      name: 'DeliveryRouteResolutionError',
      code: 'missing_delivery_route',
      context: {
        cokeAccountId: 'acct_1',
        businessConversationKey: 'biz_conv_1',
      },
    });

    const first = await postOutbound(body);
    const second = await postOutbound(body);

    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    await expect(first.json()).resolves.toEqual({
      ok: false,
      error: 'stored_delivery_target_missing',
    });
    expect(resolveExactDeliveryRoute).not.toHaveBeenCalled();
    expect(db.outboundDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('does not reclaim failed key when channel is missing, preventing pending wedge on retries', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        ...normalizePayload(body),
        channel_id: 'ch_1',
        external_end_user_id: 'wxid_1',
      },
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);
    vi.mocked(resolveExactDeliveryRoute).mockResolvedValue(resolvedRoute as never);
    vi.mocked(db.channel.findFirst).mockResolvedValue(null as never);

    const first = await postOutbound(body);
    const second = await postOutbound(body);

    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    await expect(first.json()).resolves.toEqual({
      ok: false,
      error: 'channel_not_found',
    });
    expect(db.outboundDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('resolves exact delivery route and delivers via external end-user id', async () => {
    const res = await postOutbound(makeBody());

    expect(res.status).toBe(200);
    expect(resolveExactDeliveryRoute).toHaveBeenCalledWith({
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
    });
    expect(db.channel.findFirst).toHaveBeenCalledWith({
      where: { id: 'ch_1', tenantId: 'ten_1' },
    });
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', {
      text: 'hello',
      messageType: 'text',
      mediaUrls: [],
      audioAsVoice: false,
    });
  });

  it('reclaims failed shared-channel deliveries through the stored shared channel id and peer target', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        ...normalizePayload(body),
        channel_id: 'ch_1',
        external_end_user_id: 'wxid_1',
      },
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);
    vi.mocked(db.channel.findFirst).mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'ch_1') {
        return channel as never;
      }

      if (where.id === 'ch_2') {
        return movedChannel as never;
      }

      return null as never;
    });

    const res = await postOutbound(body);

    expect(res.status).toBe(200);
    expect(resolveExactDeliveryRoute).not.toHaveBeenCalled();
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', {
      text: 'hello',
      messageType: 'text',
      mediaUrls: [],
      audioAsVoice: false,
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalledWith(movedChannel, 'wxid_2', {
      text: 'hello',
      messageType: 'text',
      mediaUrls: [],
      audioAsVoice: false,
    });
  });

  it('fails reclaimed deliveries when the stored shared channel target is gone instead of rerouting', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValueOnce({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        ...normalizePayload(body),
        channel_id: 'ch_1',
        external_end_user_id: 'wxid_1',
      },
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);
    vi.mocked(db.channel.findFirst).mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'ch_2') {
        return movedChannel as never;
      }

      return null as never;
    });

    const res = await postOutbound(body);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'channel_not_found',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('stores the exact delivery target on newly created outbound deliveries', async () => {
    const res = await postOutbound(makeBody());

    expect(res.status).toBe(200);
    expect(db.outboundDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          channel_id: 'ch_1',
          external_end_user_id: 'wxid_1',
        }),
      }),
    });
  });

  it('accepts customer_id as a compatibility alias', async () => {
    const body = makeBody({
      account_id: undefined,
      customer_id: 'ck_123',
    });

    const res = await postOutbound(body);

    expect(res.status).toBe(200);
    expect(resolveExactDeliveryRoute).toHaveBeenCalledWith({
      cokeAccountId: 'ck_123',
      businessConversationKey: 'biz_conv_1',
    });
    expect(db.outboundDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          customer_id: 'ck_123',
        }),
      }),
    });
  });

  it('returns 409 and suppresses delivery for duplicate request with same payload', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
      id: 'outbound_1',
      status: 'succeeded',
      payload: normalizePayload(body),
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
      } as never);

    const first = await postOutbound(body);
    const second = await postOutbound(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_request',
      idempotency_key: 'idem_1',
    });
    expect(db.outboundDelivery.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'idem_1' },
    });
    expect(deliverOutboundMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps idempotency global when exact route changes channels between retries', async () => {
    const body = makeBody();
    vi.mocked(resolveExactDeliveryRoute)
      .mockResolvedValueOnce(resolvedRoute as never);
    vi.mocked(db.channel.findFirst)
      .mockResolvedValueOnce(channel as never);
    vi.mocked(db.outboundDelivery.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
      id: 'outbound_1',
      status: 'succeeded',
      payload: normalizePayload(body),
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
      } as never);

    const first = await postOutbound(body);
    const second = await postOutbound(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_request',
      idempotency_key: 'idem_1',
    });
    expect(db.outboundDelivery.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'idem_1' },
    });
    expect(resolveExactDeliveryRoute).toHaveBeenCalledTimes(1);
    expect(deliverOutboundMessage).toHaveBeenCalledTimes(1);
  });

  it('returns 409 for conflicting payload with reused idempotency key', async () => {
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'succeeded',
      payload: normalizePayload(
        makeBody({
          text: 'original',
        }),
      ),
    } as never);

    const res = await postOutbound(
      makeBody({
        text: 'changed',
      }),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'idempotency_key_conflict',
      idempotency_key: 'idem_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it.each([123, ''])(
    'returns 409 for stored malformed causal_inbound_event_id %s with reused idempotency key',
    async (storedCausalInboundEventId) => {
      const body = makeBody();
      vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
        id: 'outbound_1',
        status: 'succeeded',
        payload: {
          ...normalizePayload(body),
          causal_inbound_event_id: storedCausalInboundEventId,
        },
      } as never);

      const res = await postOutbound(body);

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: 'idempotency_key_conflict',
        idempotency_key: 'idem_1',
      });
      expect(deliverOutboundMessage).not.toHaveBeenCalled();
    },
  );

  it('returns 409 for in-progress duplicate with same payload', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'pending',
      payload: normalizePayload(body),
    } as never);

    const res = await postOutbound(body);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_request_in_progress',
      idempotency_key: 'idem_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('retries delivery for failed key when payload matches', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        ...normalizePayload(body),
        channel_id: 'ch_1',
        external_end_user_id: 'wxid_1',
      },
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);

    const res = await postOutbound(body);

    expect(res.status).toBe(200);
    expect(db.outboundDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'outbound_1',
        status: 'failed',
      },
      data: {
        status: 'pending',
        error: null,
      },
    });
    expect(db.outboundDelivery.update).toHaveBeenCalledWith({
      where: { id: 'outbound_1' },
      data: {
        status: 'succeeded',
        error: null,
      },
    });
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', {
      text: 'hello',
      messageType: 'text',
      mediaUrls: [],
      audioAsVoice: false,
    });
  });

  it('persists failed idempotency status before surfacing delivery errors', async () => {
    vi.mocked(deliverOutboundMessage).mockRejectedValueOnce(new Error('gateway down'));

    const res = await postOutbound(makeBody());

    expect(res.status).toBe(500);
    expect(db.outboundDelivery.update).toHaveBeenCalledWith({
      where: { id: 'outbound_1' },
      data: {
        status: 'failed',
        error: 'gateway down',
      },
    });
  });

  it('does not deliver when failed-key reclaim race is lost', async () => {
    const body = makeBody();
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        ...normalizePayload(body),
        channel_id: 'ch_1',
        external_end_user_id: 'wxid_1',
      },
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);
    vi.mocked(db.outboundDelivery.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const res = await postOutbound(body);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_request_in_progress',
      idempotency_key: 'idem_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('accepts image media payloads and stores normalized media fields', async () => {
    const body = makeBody({
      message_type: 'image',
      text: 'photo caption',
      mediaUrls: ['https://cdn.example.com/photo.jpg'],
    });

    const res = await postOutbound(body);

    expect(res.status).toBe(200);
    expect(db.outboundDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          message_type: 'image',
          text: 'photo caption',
          mediaUrls: ['https://cdn.example.com/photo.jpg'],
          audioAsVoice: false,
          channel_id: 'ch_1',
          external_end_user_id: 'wxid_1',
        }),
      }),
    });
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', {
      text: 'photo caption',
      messageType: 'image',
      mediaUrls: ['https://cdn.example.com/photo.jpg'],
      audioAsVoice: false,
    });
  });

  it('accepts media-only voice payloads and coerces audioAsVoice', async () => {
    const res = await postOutbound(
      makeBody({
        message_type: 'voice',
        text: undefined,
        mediaUrls: ['https://cdn.example.com/voice.mp3'],
      }),
    );

    expect(res.status).toBe(200);
    expect(db.outboundDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          message_type: 'voice',
          text: '',
          mediaUrls: ['https://cdn.example.com/voice.mp3'],
          audioAsVoice: true,
        }),
      }),
    });
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', {
      text: '',
      messageType: 'voice',
      mediaUrls: ['https://cdn.example.com/voice.mp3'],
      audioAsVoice: true,
    });
  });

  it('rejects media message types without media URLs', async () => {
    const res = await postOutbound(
      makeBody({
        message_type: 'image',
        text: 'caption',
        mediaUrls: [],
      }),
    );

    expect(res.status).toBe(400);
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it.each(['file:///tmp/photo.jpg', '/tmp/photo.jpg', 'photo.jpg', 'data:image/png;base64,abc'])(
    'rejects unsupported media URL %s',
    async (mediaUrl) => {
      const res = await postOutbound(
        makeBody({
          message_type: 'image',
          mediaUrls: [mediaUrl],
        }),
      );

      expect(res.status).toBe(400);
      expect(deliverOutboundMessage).not.toHaveBeenCalled();
    },
  );

  it('rejects voice payloads that explicitly disable audioAsVoice', async () => {
    const res = await postOutbound(
      makeBody({
        message_type: 'voice',
        mediaUrls: ['https://cdn.example.com/voice.mp3'],
        audioAsVoice: false,
      }),
    );

    expect(res.status).toBe(400);
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('rejects audioAsVoice on non-voice payloads', async () => {
    const res = await postOutbound(
      makeBody({
        message_type: 'image',
        mediaUrls: ['https://cdn.example.com/photo.jpg'],
        audioAsVoice: true,
      }),
    );

    expect(res.status).toBe(400);
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('returns 409 for conflicting media payload with reused idempotency key', async () => {
    const original = makeBody({
      message_type: 'image',
      mediaUrls: ['https://cdn.example.com/original.jpg'],
    });
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'succeeded',
      payload: normalizePayload(original),
    } as never);

    const res = await postOutbound(
      makeBody({
        message_type: 'image',
        mediaUrls: ['https://cdn.example.com/changed.jpg'],
      }),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'idempotency_key_conflict',
      idempotency_key: 'idem_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('returns duplicate for succeeded media-only voice payload with same idempotency key', async () => {
    const body = makeBody({
      message_type: 'voice',
      text: undefined,
      mediaUrls: ['https://cdn.example.com/voice.mp3'],
    });
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'succeeded',
      payload: normalizePayload(body),
    } as never);

    const res = await postOutbound(body);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_request',
      idempotency_key: 'idem_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('reclaims failed media-only voice payload with same idempotency key', async () => {
    const body = makeBody({
      message_type: 'voice',
      text: undefined,
      mediaUrls: ['https://cdn.example.com/voice.mp3'],
    });
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        ...normalizePayload(body),
        channel_id: 'ch_1',
        external_end_user_id: 'wxid_1',
      },
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);

    const res = await postOutbound(body);

    expect(res.status).toBe(200);
    expect(db.outboundDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'outbound_1',
        status: 'failed',
      },
      data: {
        status: 'pending',
        error: null,
      },
    });
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', {
      text: '',
      messageType: 'voice',
      mediaUrls: ['https://cdn.example.com/voice.mp3'],
      audioAsVoice: true,
    });
  });

  it('returns duplicate for legacy text-only succeeded payload without media fields', async () => {
    const body = makeBody();
    const { mediaUrls: _mediaUrls, audioAsVoice: _audioAsVoice, ...legacyPayload } = normalizePayload(body);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'succeeded',
      payload: legacyPayload,
    } as never);

    const res = await postOutbound(body);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_request',
      idempotency_key: 'idem_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('reclaims legacy text-only failed payload without media fields', async () => {
    const body = makeBody();
    const { mediaUrls: _mediaUrls, audioAsVoice: _audioAsVoice, ...legacyPayload } = normalizePayload(body);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        ...legacyPayload,
        channel_id: 'ch_1',
        external_end_user_id: 'wxid_1',
      },
      tenantId: 'ten_1',
      channelId: 'ch_1',
      idempotencyKey: 'idem_1',
    } as never);

    const res = await postOutbound(body);

    expect(res.status).toBe(200);
    expect(db.outboundDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'outbound_1',
        status: 'failed',
      },
      data: {
        status: 'pending',
        error: null,
      },
    });
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', {
      text: 'hello',
      messageType: 'text',
      mediaUrls: [],
      audioAsVoice: false,
    });
  });
});
