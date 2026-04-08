import { describe, expect, it, vi, beforeEach } from 'vitest';
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

vi.mock('../lib/outbound-delivery.js', () => ({
  deliverOutboundMessage: vi.fn(),
}));

import { outboundRouter } from './outbound.js';
import { db } from '../db/index.js';
import { deliverOutboundMessage } from '../lib/outbound-delivery.js';

const channel = {
  id: 'ch_1',
  tenantId: 'ten_1',
};

function makeApp() {
  const app = new Hono();
  app.route('/api/outbound', outboundRouter);
  return app;
}

async function postOutbound(body: Record<string, unknown>) {
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
    process.env.CLAWSCALE_OUTBOUND_API_KEY = 'secret';
    vi.mocked(db.channel.findFirst).mockResolvedValue(channel as never);
    vi.mocked(db.outboundDelivery.create).mockResolvedValue({ id: 'outbound_1' } as never);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.outboundDelivery.update).mockResolvedValue({ id: 'outbound_1' } as never);
    vi.mocked(db.outboundDelivery.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(deliverOutboundMessage).mockResolvedValue(undefined as never);
    vi.clearAllMocks();
  });

  it('rejects invalid bearer tokens', async () => {
    const app = makeApp();

    const res = await app.request('/api/outbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: JSON.stringify({
        tenant_id: 'ten_1',
        channel_id: 'ch_1',
        end_user_id: 'wxid_1',
        text: 'hello',
        idempotency_key: 'push_1',
      }),
    });

    expect(res.status).toBe(401);
  });

  it('accepts external_end_user_id as the canonical peer id field', async () => {
    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(200);
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', 'hello');
  });

  it('returns 409 and suppresses delivery for a duplicate request with the same payload', async () => {
    vi.mocked(db.outboundDelivery.create)
      .mockResolvedValueOnce({ id: 'outbound_1' } as never)
      .mockRejectedValueOnce({ code: 'P2002' } as never);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'succeeded',
      payload: {
        external_end_user_id: 'wxid_1',
        text: 'hello',
      },
    } as never);

    const first = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });
    const second = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      ok: false,
      error: 'duplicate_request',
      idempotency_key: 'push_1',
    });
    expect(deliverOutboundMessage).toHaveBeenCalledTimes(1);
  });

  it('returns 409 and rejects conflicting payloads for a reused idempotency key', async () => {
    vi.mocked(db.outboundDelivery.create).mockRejectedValueOnce({ code: 'P2002' } as never);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'succeeded',
      payload: {
        external_end_user_id: 'wxid_original',
        text: 'hello',
      },
    } as never);

    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_changed',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'idempotency_key_conflict',
      idempotency_key: 'push_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('returns 409 for an in-progress duplicate with the same payload', async () => {
    vi.mocked(db.outboundDelivery.create).mockRejectedValueOnce({ code: 'P2002' } as never);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'pending',
      payload: {
        external_end_user_id: 'wxid_1',
        text: 'hello',
      },
    } as never);

    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'duplicate_request_in_progress',
      idempotency_key: 'push_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('retries delivery for a failed key when the payload matches', async () => {
    vi.mocked(db.outboundDelivery.create).mockRejectedValueOnce({ code: 'P2002' } as never);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        external_end_user_id: 'wxid_1',
        text: 'hello',
      },
    } as never);

    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

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
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', 'hello');
  });

  it('persists a failed idempotency record before surfacing delivery errors', async () => {
    vi.mocked(deliverOutboundMessage).mockRejectedValueOnce(new Error('gateway down'));

    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(500);
    expect(db.outboundDelivery.update).toHaveBeenCalledWith({
      where: { id: 'outbound_1' },
      data: {
        status: 'failed',
        error: 'gateway down',
      },
    });
  });

  it('does not deliver when a concurrent request wins the failed-key reclaim race', async () => {
    vi.mocked(db.outboundDelivery.create).mockRejectedValueOnce({ code: 'P2002' } as never);
    vi.mocked(db.outboundDelivery.findUnique).mockResolvedValue({
      id: 'outbound_1',
      status: 'failed',
      payload: {
        external_end_user_id: 'wxid_1',
        text: 'hello',
      },
    } as never);
    vi.mocked(db.outboundDelivery.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'duplicate_request_in_progress',
      idempotency_key: 'push_1',
    });
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });

  it('accepts end_user_id as a compatibility alias', async () => {
    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(200);
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', 'hello');
  });

  it('accepts both fields when they match', async () => {
    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_1',
      end_user_id: 'wxid_1',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(200);
    expect(deliverOutboundMessage).toHaveBeenCalledWith(channel, 'wxid_1', 'hello');
  });

  it('rejects conflicting end user ids when both fields are present', async () => {
    const res = await postOutbound({
      tenant_id: 'ten_1',
      channel_id: 'ch_1',
      external_end_user_id: 'wxid_external',
      end_user_id: 'wxid_legacy',
      text: 'hello',
      idempotency_key: 'push_1',
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'validation_error',
      }),
    );
    expect(deliverOutboundMessage).not.toHaveBeenCalled();
  });
});
