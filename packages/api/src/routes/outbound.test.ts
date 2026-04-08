import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../db/index.js', () => ({
  db: {
    channel: {
      findFirst: vi.fn(),
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
});
