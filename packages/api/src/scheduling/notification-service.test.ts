import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueSchedulingNotification,
  retryPendingSchedulingNotifications,
} from './notification-service.js';

const client = {
  schedulingNotification: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
};

describe('notification service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T11:00:00.000Z'));
    vi.resetAllMocks();
    vi.stubEnv('COKE_BRIDGE_INBOUND_URL', 'http://127.0.0.1:8090/bridge/inbound');
    vi.stubEnv('COKE_BRIDGE_API_KEY', 'bridge-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('persists notification intent before calling Bridge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    client.schedulingNotification.create.mockResolvedValueOnce({
      id: 'sn_1',
      idempotencyKey: 'appt:ar_1:request:A',
      recipientAccountId: 'ck_a',
      payload: {
        text: 'Student B requested Tuesday 7 PM',
        metadata: { requestId: 'ar_1', allowedActions: ['confirm', 'reject'] },
      },
      kind: 'appointment_request',
      appointmentId: 'ar_1',
    });
    client.schedulingNotification.update.mockResolvedValueOnce({ id: 'sn_1', status: 'delivered' });

    await enqueueSchedulingNotification(client as never, {
      appointmentId: 'ar_1',
      recipientAccountId: 'ck_a',
      idempotencyKey: 'appt:ar_1:request:A',
      kind: 'appointment_request',
      text: 'Student B requested Tuesday 7 PM',
      metadata: { requestId: 'ar_1', allowedActions: ['confirm', 'reject'] },
    });

    expect(client.schedulingNotification.create).toHaveBeenCalledBefore(fetchMock);
    expect(client.schedulingNotification.create).toHaveBeenCalledWith({
      data: {
        appointmentId: 'ar_1',
        recipientAccountId: 'ck_a',
        idempotencyKey: 'appt:ar_1:request:A',
        kind: 'appointment_request',
        payload: {
          text: 'Student B requested Tuesday 7 PM',
          metadata: { requestId: 'ar_1', allowedActions: ['confirm', 'reject'] },
        },
        status: 'pending_delivery',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8090/bridge/inbound',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bridge-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      customer_id: 'ck_a',
      inbound_event_id: 'appt:ar_1:request:A',
      text: 'Student B requested Tuesday 7 PM',
      timestamp: 1780398000,
      message_type: 'scheduling_notification',
      scheduling: {
        kind: 'appointment_request',
        requestId: 'ar_1',
        allowedActions: ['confirm', 'reject'],
      },
    });
  });

  it('retries pending notifications and records delivery results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    client.schedulingNotification.findMany.mockResolvedValueOnce([
      {
        id: 'sn_delivered',
        recipientAccountId: 'ck_a',
        payload: { text: 'A confirmed Tuesday 7 PM', metadata: { requestId: 'ar_1' } },
        idempotencyKey: 'appt:ar_1:confirmed:B',
        kind: 'appointment_confirmed',
      },
      {
        id: 'sn_failed',
        recipientAccountId: 'ck_b',
        payload: { text: 'Delivery should retry later', metadata: { requestId: 'ar_2' } },
        idempotencyKey: 'appt:ar_2:request:A',
        kind: 'appointment_request',
      },
    ]);

    const result = await retryPendingSchedulingNotifications(client as never, { limit: 10 });

    expect(result).toEqual({ delivered: 1, failed: 1 });
    expect(client.schedulingNotification.findMany).toHaveBeenCalledWith({
      where: { status: 'pending_delivery' },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    expect(client.schedulingNotification.update).toHaveBeenCalledWith({
      where: { id: 'sn_delivered' },
      data: { status: 'delivered', deliveredAt: expect.any(Date), lastError: null },
    });
    expect(client.schedulingNotification.update).toHaveBeenCalledWith({
      where: { id: 'sn_failed' },
      data: { attempts: { increment: 1 }, lastError: 'bridge_http_502' },
    });
  });
});
