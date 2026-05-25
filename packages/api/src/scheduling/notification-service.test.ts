import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverPendingProductNotifications,
  enqueueProductNotification,
} from './notification-service.js';

function fakeNotificationClient() {
  return {
    productNotification: {
      create: vi.fn().mockResolvedValue({
        id: 'pn_1',
        recipientAccountId: 'acct_a',
        idempotencyKey: 'friend-request:fr_1:target',
        kind: 'friend_request',
        payload: {
          text: '你有一个新的好友请求，请确认或拒绝。',
          metadata: {
            request_id: 'fr_1',
            request_type: 'friend_request',
            allowed_actions: ['accept', 'reject'],
          },
        },
        status: 'pending_delivery',
      }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    deliveryRoute: {
      findFirst: vi.fn().mockResolvedValue({
        businessConversationKey: 'bc_latest',
      }),
    },
  };
}

function inMemoryNotificationClient() {
  const rows: Array<Record<string, unknown>> = [];
  const statusMatches = (actual: unknown, expected: unknown): boolean => {
    if (typeof expected === 'string') {
      return actual === expected;
    }
    if (
      typeof expected === 'object' &&
      expected !== null &&
      'in' in expected &&
      Array.isArray(expected.in)
    ) {
      return expected.in.includes(actual);
    }
    return false;
  };

  return {
    rows,
    productNotification: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `pn_${rows.length + 1}`,
          attempts: 0,
          status: 'pending_delivery',
          ...data,
        };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
        rows.filter((row) => statusMatches(row['status'], where['status'])).slice(0, take),
      ),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of rows) {
          if (row['id'] !== where['id'] || !statusMatches(row['status'], where['status'])) {
            continue;
          }
          for (const [key, value] of Object.entries(data)) {
            if (
              typeof value === 'object' &&
              value !== null &&
              'increment' in value &&
              typeof value.increment === 'number'
            ) {
              row[key] = Number(row[key] ?? 0) + value.increment;
            } else {
              row[key] = value;
            }
          }
          count += 1;
        }
        return { count };
      }),
    },
    deliveryRoute: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where['cokeAccountId'] === 'acct_a' && where['isActive'] === true) {
          return { businessConversationKey: 'bc_latest' };
        }
        return null;
      }),
    },
  };
}

describe('product notification service', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COKE_BRIDGE_INBOUND_URL = 'http://127.0.0.1:8090/bridge/inbound';
    process.env.COKE_GATEWAY_OUTBOUND_URL = 'http://127.0.0.1:4041/api/outbound';
    process.env.CLAWSCALE_OUTBOUND_API_KEY = 'outbound-secret';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.COKE_BRIDGE_INBOUND_URL;
    delete process.env.COKE_GATEWAY_OUTBOUND_URL;
    delete process.env.COKE_BRIDGE_API_KEY;
    delete process.env.CLAWSCALE_OUTBOUND_API_KEY;
  });

  it('delivers product notification through the recipient active outbound route', async () => {
    const client = fakeNotificationClient();

    await enqueueProductNotification(client as never, {
      requestId: 'fr_1',
      requestType: 'friend_request',
      recipientAccountId: 'acct_a',
      idempotencyKey: 'friend-request:fr_1:target',
      kind: 'friend_request',
      text: '你有一个新的好友请求，请确认或拒绝。',
      metadata: {
        request_id: 'fr_1',
        request_type: 'friend_request',
        allowed_actions: ['accept', 'reject'],
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4041/api/outbound',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer outbound-secret',
        }),
        body: expect.any(String),
      }),
    );
    expect(client.deliveryRoute.findFirst).toHaveBeenCalledWith({
      where: {
        cokeAccountId: 'acct_a',
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      select: { businessConversationKey: true },
    });
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      output_id: 'friend-request:fr_1:target',
      customer_id: 'acct_a',
      business_conversation_key: 'bc_latest',
      message_type: 'text',
      text: '你有一个新的好友请求，请确认或拒绝。',
      delivery_mode: 'push',
      expect_output_timestamp: expect.any(String),
      idempotency_key: 'friend-request:fr_1:target',
      trace_id: 'friend-request:fr_1:target',
      causal_inbound_event_id: 'friend-request:fr_1:target',
    });
  });

  it('retries pending product notifications and marks them delivered', async () => {
    const client = fakeNotificationClient();
    client.productNotification.findMany.mockResolvedValueOnce([
      {
        id: 'pn_1',
        recipientAccountId: 'acct_a',
        idempotencyKey: 'shared-reminder:sr_1:shared_reminder_request',
        kind: 'shared_reminder_request',
        payload: {
          text: '你有一个共享提醒请求，请确认或拒绝。',
          metadata: {
            request_id: 'sr_1',
            request_type: 'shared_reminder_request',
            allowed_actions: ['accept', 'reject'],
          },
        },
      },
    ]);

    await expect(deliverPendingProductNotifications(client as never, { limit: 5 })).resolves.toEqual({
      delivered: 1,
      failed: 0,
    });

    expect(client.productNotification.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['pending_delivery', 'failed'] } },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    expect(client.productNotification.updateMany).toHaveBeenCalledWith({
      where: { id: 'pn_1', status: { in: ['pending_delivery', 'failed'] } },
      data: {
        status: 'delivered',
        deliveredAt: expect.any(Date),
        lastError: null,
      },
    });
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      output_id: 'shared-reminder:sr_1:shared_reminder_request',
      customer_id: 'acct_a',
      business_conversation_key: 'bc_latest',
      message_type: 'text',
      text: '你有一个共享提醒请求，请确认或拒绝。',
      delivery_mode: 'push',
      idempotency_key: 'shared-reminder:sr_1:shared_reminder_request',
      trace_id: 'shared-reminder:sr_1:shared_reminder_request',
      causal_inbound_event_id: 'shared-reminder:sr_1:shared_reminder_request',
    });
  });

  it('marks product notifications failed when the recipient has no active delivery route', async () => {
    const client = fakeNotificationClient();
    client.deliveryRoute.findFirst.mockResolvedValueOnce(null);

    await enqueueProductNotification(client as never, {
      requestId: 'fr_1',
      requestType: 'friend_request',
      recipientAccountId: 'acct_a',
      idempotencyKey: 'friend-request:fr_1:target',
      kind: 'friend_request',
      text: '你有一个新的好友请求，请确认或拒绝。',
      metadata: {
        request_id: 'fr_1',
        request_type: 'friend_request',
        allowed_actions: ['accept', 'reject'],
      },
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(client.productNotification.updateMany).toHaveBeenCalledWith({
      where: { id: 'pn_1', status: { in: ['pending_delivery', 'failed'] } },
      data: {
        status: 'failed',
        attempts: { increment: 1 },
        lastError: 'product_notification_missing_delivery_route',
      },
    });
  });

  it('retries notifications that failed during first delivery', async () => {
    const client = inMemoryNotificationClient();
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await enqueueProductNotification(client as never, {
      requestId: 'fr_1',
      requestType: 'friend_request',
      recipientAccountId: 'acct_a',
      idempotencyKey: 'friend-request:fr_1:target',
      kind: 'friend_request',
      text: '你有一个新的好友请求，请确认或拒绝。',
      metadata: {
        request_id: 'fr_1',
        request_type: 'friend_request',
        allowed_actions: ['accept', 'reject'],
      },
    });

    expect(client.rows[0]?.['status']).toBe('failed');
    expect(client.rows[0]?.['attempts']).toBe(1);

    await expect(deliverPendingProductNotifications(client as never, { limit: 5 })).resolves.toEqual({
      delivered: 1,
      failed: 0,
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(client.productNotification.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['pending_delivery', 'failed'] } },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    expect(client.rows[0]?.['status']).toBe('delivered');
    expect(client.rows[0]?.['lastError']).toBeNull();
  });
});
