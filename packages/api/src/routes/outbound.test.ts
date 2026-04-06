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

describe('outbound router', () => {
  beforeEach(() => {
    process.env.CLAWSCALE_OUTBOUND_API_KEY = 'secret';
  });

  it('rejects invalid bearer tokens', async () => {
    const app = new Hono();
    app.route('/api/outbound', outboundRouter);

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
});
