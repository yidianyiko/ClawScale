import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAppointment,
  confirmAppointment,
  listPendingRequests,
  queryBookableWindows,
  rejectAppointment,
  requestAppointment,
} from './appointment-service.js';

const tx = {
  serviceLink: { findFirst: vi.fn(), updateMany: vi.fn() },
  bookableWindow: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  bookableWindowExclusion: { findMany: vi.fn() },
  appointmentRequest: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  appointmentEvent: { findFirst: vi.fn(), create: vi.fn() },
  schedulingNotification: { create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
};

describe('appointment service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
    tx.appointmentRequest.findMany.mockResolvedValue([]);
    tx.appointmentRequest.findFirst.mockResolvedValue(null);
    tx.appointmentEvent.findFirst.mockResolvedValue(null);
    tx.serviceLink.updateMany.mockResolvedValue({ count: 1 });
    tx.bookableWindow.updateMany.mockResolvedValue({ count: 1 });
    tx.schedulingNotification.create.mockImplementation(async ({ data }) => ({
      id: 'sn_1',
      ...data,
    }));
    tx.schedulingNotification.update.mockResolvedValue({ id: 'sn_1', status: 'delivered' });
    tx.$transaction.mockImplementation(async (fn) => fn(tx));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockActiveServiceLink() {
    tx.serviceLink.findFirst.mockResolvedValueOnce({
      id: 'sl_1',
      status: 'active',
      capabilities: ['appointment_request'],
    });
  }

  const activeWeeklyWindow = {
    id: 'bw_1',
    rule: {
      type: 'weekly',
      days_of_week: [2],
      time_start: '19:00',
      time_end: '21:00',
      timezone: 'Asia/Shanghai',
      effective_from: '2026-06-01',
      effective_until: null,
    },
  };

  function mockActiveWindow() {
    tx.bookableWindow.findFirst.mockResolvedValueOnce(activeWeeklyWindow);
    tx.bookableWindowExclusion.findMany.mockResolvedValueOnce([]);
  }

  it('queries bookable windows and serializes occupied DB dates before filtering instances', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({
      id: 'sl_1',
      status: 'active',
      capabilities: ['appointment_request'],
    });
    tx.bookableWindow.findMany.mockResolvedValueOnce([
      {
        id: 'bw_1',
        rule: {
          type: 'weekly',
          days_of_week: [2],
          time_start: '19:00',
          time_end: '21:00',
          timezone: 'Asia/Shanghai',
          effective_from: '2026-06-01',
          effective_until: null,
        },
      },
    ]);
    tx.bookableWindowExclusion.findMany.mockResolvedValueOnce([]);
    tx.appointmentRequest.findMany.mockResolvedValueOnce([
      {
        instanceStart: new Date('2026-06-02T11:00:00.000Z'),
        instanceEnd: new Date('2026-06-02T13:00:00.000Z'),
      },
    ]);

    const result = await queryBookableWindows(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-09',
      viewerTimezone: 'Asia/Shanghai',
    });

    expect(result.serviceLinkId).toBe('sl_1');
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]).toMatchObject({
      bookableWindowId: 'bw_1',
      instanceStart: '2026-06-09T11:00:00.000Z',
      instanceEnd: '2026-06-09T13:00:00.000Z',
      localDate: '2026-06-09',
      localTime: '19:00',
    });
  });

  it('requires an active service link with appointment request capability', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce(null);

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-06-02T11:00:00.000Z',
        instanceEnd: '2026-06-02T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_0',
      }),
    ).rejects.toThrow('service_link_required');

    expect(tx.serviceLink.findFirst).toHaveBeenCalledWith({
      where: {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        status: 'active',
        capabilities: { has: 'appointment_request' },
      },
    });
    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
  });

  it('allows the same B to hold multiple independent instances with A', async () => {
    tx.serviceLink.findFirst.mockResolvedValue({
      id: 'sl_1',
      status: 'active',
      capabilities: ['appointment_request'],
    });
    tx.bookableWindow.findFirst.mockResolvedValue(activeWeeklyWindow);
    tx.bookableWindowExclusion.findMany.mockResolvedValue([]);
    tx.appointmentRequest.create
      .mockResolvedValueOnce({
        id: 'ar_1',
        status: 'pending_held',
        instanceStart: new Date('2026-06-02T11:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'ar_2',
        status: 'pending_held',
        instanceStart: new Date('2026-06-09T11:00:00.000Z'),
      });

    await requestAppointment(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      bookableWindowId: 'bw_1',
      instanceStart: '2026-06-02T11:00:00.000Z',
      instanceEnd: '2026-06-02T13:00:00.000Z',
      timezone: 'Asia/Shanghai',
      idempotencyKey: 'msg_1',
    });
    await requestAppointment(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      bookableWindowId: 'bw_1',
      instanceStart: '2026-06-09T11:00:00.000Z',
      instanceEnd: '2026-06-09T13:00:00.000Z',
      timezone: 'Asia/Shanghai',
      idempotencyKey: 'msg_2',
    });

    expect(tx.appointmentRequest.create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tx.appointmentRequest.create.mock.calls)).not.toContain('holdExpiresAt');
  });

  it('maps Postgres unique conflicts to slot_unavailable', async () => {
    mockActiveServiceLink();
    mockActiveWindow();
    tx.appointmentRequest.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_c',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-06-02T11:00:00.000Z',
        instanceEnd: '2026-06-02T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_3',
      }),
    ).rejects.toThrow('slot_unavailable');
  });

  it('rejects requests for missing or closed bookable windows before insert', async () => {
    mockActiveServiceLink();
    tx.bookableWindow.findFirst.mockResolvedValueOnce(null);

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        bookableWindowId: 'bw_closed',
        instanceStart: '2026-06-02T11:00:00.000Z',
        instanceEnd: '2026-06-02T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_closed',
      }),
    ).rejects.toThrow('slot_unavailable');

    expect(tx.bookableWindow.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'bw_closed',
        providerAccountId: 'ck_a',
        capability: 'appointment_request',
        status: 'active',
      },
    });
    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects excluded bookable window instances before insert', async () => {
    mockActiveServiceLink();
    tx.bookableWindow.findFirst.mockResolvedValueOnce(activeWeeklyWindow);
    tx.bookableWindowExclusion.findMany.mockResolvedValueOnce([
      {
        instanceStart: new Date('2026-06-02T11:00:00.000Z'),
        instanceEnd: new Date('2026-06-02T13:00:00.000Z'),
      },
    ]);

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-06-02T11:00:00.000Z',
        instanceEnd: '2026-06-02T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_excluded',
      }),
    ).rejects.toThrow('slot_unavailable');

    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects arbitrary non-generated instances before insert', async () => {
    mockActiveServiceLink();
    mockActiveWindow();

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-06-03T11:00:00.000Z',
        instanceEnd: '2026-06-03T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_arbitrary',
      }),
    ).rejects.toThrow('slot_unavailable');

    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects generated instances already occupied by another provider window', async () => {
    mockActiveServiceLink();
    mockActiveWindow();
    tx.appointmentRequest.findMany.mockResolvedValueOnce([
      {
        instanceStart: new Date('2026-06-02T11:00:00.000Z'),
        instanceEnd: new Date('2026-06-02T13:00:00.000Z'),
      },
    ]);

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-06-02T11:00:00.000Z',
        instanceEnd: '2026-06-02T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_occupied',
      }),
    ).rejects.toThrow('slot_unavailable');

    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('does not create a request when the active window guard loses a close race', async () => {
    mockActiveServiceLink();
    mockActiveWindow();
    tx.bookableWindow.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-06-02T11:00:00.000Z',
        instanceEnd: '2026-06-02T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_window_guard',
      }),
    ).rejects.toThrow('slot_unavailable');

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sl_1',
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        status: 'active',
        capabilities: { has: 'appointment_request' },
      },
      data: { status: 'active' },
    });
    expect(tx.bookableWindow.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bw_1',
        providerAccountId: 'ck_a',
        capability: 'appointment_request',
        status: 'active',
      },
      data: { status: 'active' },
    });
    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('does not create a request when the active service-link guard loses a removal race', async () => {
    mockActiveServiceLink();
    mockActiveWindow();
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      requestAppointment(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        bookableWindowId: 'bw_1',
        instanceStart: '2026-06-02T11:00:00.000Z',
        instanceEnd: '2026-06-02T13:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'msg_link_guard',
      }),
    ).rejects.toThrow('service_link_required');

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sl_1',
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        status: 'active',
        capabilities: { has: 'appointment_request' },
      },
      data: { status: 'active' },
    });
    expect(tx.bookableWindow.updateMany).not.toHaveBeenCalled();
    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('creates the request and requested event in a transaction when available', async () => {
    const writeClient = {
      serviceLink: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'sl_tx',
          status: 'active',
          capabilities: ['appointment_request'],
        }),
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
      },
      bookableWindow: {
        findFirst: vi.fn().mockResolvedValueOnce(activeWeeklyWindow),
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
      },
      bookableWindowExclusion: { findMany: vi.fn().mockResolvedValueOnce([]) },
      appointmentRequest: {
        findMany: vi.fn().mockResolvedValueOnce([]),
        create: vi.fn().mockResolvedValueOnce({
          id: 'ar_tx',
          providerAccountId: 'ck_a',
          consumerAccountId: 'ck_b',
          status: 'pending_held',
        }),
      },
      appointmentEvent: { create: vi.fn() },
    };
    tx.$transaction.mockImplementationOnce(async (fn) => fn(writeClient));

    await requestAppointment(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      bookableWindowId: 'bw_1',
      instanceStart: '2026-06-02T11:00:00.000Z',
      instanceEnd: '2026-06-02T13:00:00.000Z',
      timezone: 'Asia/Shanghai',
      idempotencyKey: 'msg_tx',
    });

    expect(tx.$transaction).toHaveBeenCalledTimes(1);
    expect(writeClient.serviceLink.findFirst).toHaveBeenCalledWith({
      where: {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
        status: 'active',
        capabilities: { has: 'appointment_request' },
      },
    });
    expect(writeClient.bookableWindow.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'bw_1',
        providerAccountId: 'ck_a',
        capability: 'appointment_request',
        status: 'active',
      },
    });
    expect(writeClient.appointmentRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'msg_tx',
      }),
    });
    expect(writeClient.appointmentRequest.create).toHaveBeenCalledTimes(1);
    expect(writeClient.appointmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_tx',
        fromState: null,
        toState: 'pending_held',
        actorAccountId: 'ck_b',
        actorRole: 'consumer',
        idempotencyKey: 'msg_tx:event:requested',
        reason: 'requested',
      }),
    });
    expect(tx.schedulingNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_tx',
        recipientAccountId: 'ck_a',
        idempotencyKey: 'appt:ar_tx:request:A',
        kind: 'appointment_request',
      }),
    });
    expect(tx.serviceLink.findFirst).not.toHaveBeenCalled();
    expect(tx.bookableWindow.findFirst).not.toHaveBeenCalled();
    expect(tx.bookableWindowExclusion.findMany).not.toHaveBeenCalled();
    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('confirms pending held requests by provider with a conditional update and event', async () => {
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_1',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'pending_held',
    });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    await confirmAppointment(tx as never, {
      actorAccountId: 'ck_a',
      requestId: 'ar_1',
      idempotencyKey: 'msg_4',
    });

    expect(tx.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ar_1', providerAccountId: 'ck_a', status: 'pending_held' },
      data: { status: 'confirmed_shared' },
    });
    expect(tx.appointmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_1',
        fromState: 'pending_held',
        toState: 'confirmed_shared',
        actorAccountId: 'ck_a',
        actorRole: 'provider',
        idempotencyKey: 'msg_4',
        reason: 'confirmed_by_a',
      }),
    });
    expect(tx.schedulingNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_1',
        recipientAccountId: 'ck_b',
        idempotencyKey: 'appt:ar_1:confirmed:B',
        kind: 'appointment_confirmed',
      }),
    });
  });

  it('confirms and writes the event in a transaction when available', async () => {
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_tx_confirm',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'pending_held',
    });
    const writeClient = {
      appointmentRequest: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }) },
      appointmentEvent: { create: vi.fn() },
    };
    tx.$transaction.mockImplementationOnce(async (fn) => fn(writeClient));

    await confirmAppointment(tx as never, {
      actorAccountId: 'ck_a',
      requestId: 'ar_tx_confirm',
      idempotencyKey: 'msg_confirm_tx',
    });

    expect(tx.$transaction).toHaveBeenCalledTimes(1);
    expect(writeClient.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ar_tx_confirm', providerAccountId: 'ck_a', status: 'pending_held' },
      data: { status: 'confirmed_shared' },
    });
    expect(writeClient.appointmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_tx_confirm',
        fromState: 'pending_held',
        toState: 'confirmed_shared',
      }),
    });
    expect(tx.appointmentRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('does not emit a confirm event when the conditional transition fails', async () => {
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_released',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'pending_held',
    });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      confirmAppointment(tx as never, {
        actorAccountId: 'ck_a',
        requestId: 'ar_released',
        idempotencyKey: 'msg_5',
      }),
    ).rejects.toThrow('appointment_not_found');

    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects pending held requests by provider with release reason and event', async () => {
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_2',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'pending_held',
    });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    await rejectAppointment(tx as never, {
      actorAccountId: 'ck_a',
      requestId: 'ar_2',
      idempotencyKey: 'msg_6',
    });

    expect(tx.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ar_2', providerAccountId: 'ck_a', status: 'pending_held' },
      data: { status: 'released', releaseReason: 'rejected_by_a', releasedAt: expect.any(Date) },
    });
    expect(tx.appointmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_2',
        fromState: 'pending_held',
        toState: 'released',
        actorAccountId: 'ck_a',
        actorRole: 'provider',
        idempotencyKey: 'msg_6',
        reason: 'rejected_by_a',
      }),
    });
    expect(tx.schedulingNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_2',
        recipientAccountId: 'ck_b',
        idempotencyKey: 'appt:ar_2:rejected:B',
        kind: 'appointment_rejected',
      }),
    });
  });

  it('cancels active requests by either participant and does not mutate released appointments', async () => {
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_3',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'confirmed_shared',
    });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    await cancelAppointment(tx as never, {
      actorAccountId: 'ck_b',
      requestId: 'ar_3',
      idempotencyKey: 'msg_7',
    });

    expect(tx.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ar_3',
        status: 'confirmed_shared',
        OR: [
          { providerAccountId: 'ck_b' },
          { consumerAccountId: 'ck_b' },
        ],
      },
      data: { status: 'released', releaseReason: 'cancelled_by_b', releasedAt: expect.any(Date) },
    });
    expect(tx.appointmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_3',
        fromState: 'confirmed_shared',
        toState: 'released',
        actorAccountId: 'ck_b',
        actorRole: 'consumer',
        idempotencyKey: 'msg_7',
        reason: 'cancelled_by_b',
      }),
    });
    expect(tx.schedulingNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_3',
        recipientAccountId: 'ck_a',
        idempotencyKey: 'appt:ar_3:cancelled_by_b:A',
        kind: 'appointment_cancelled',
      }),
    });

    tx.appointmentRequest.findFirst.mockResolvedValueOnce(null);

    await expect(
      cancelAppointment(tx as never, {
        actorAccountId: 'ck_b',
        requestId: 'ar_released',
        idempotencyKey: 'msg_8',
      }),
    ).rejects.toThrow('appointment_not_found');
    expect(tx.appointmentEvent.create).toHaveBeenCalledTimes(1);
  });

  it('replays request appointment by idempotency key and ensures the notification exists', async () => {
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_existing',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'pending_held',
    });

    const result = await requestAppointment(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      bookableWindowId: 'bw_1',
      instanceStart: '2026-06-02T11:00:00.000Z',
      instanceEnd: '2026-06-02T13:00:00.000Z',
      timezone: 'Asia/Shanghai',
      idempotencyKey: 'msg_existing',
    });

    expect(result.id).toBe('ar_existing');
    expect(tx.appointmentRequest.create).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
    expect(tx.schedulingNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_existing',
        recipientAccountId: 'ck_a',
        idempotencyKey: 'appt:ar_existing:request:A',
        kind: 'appointment_request',
      }),
    });
  });

  it('replays appointment transitions by scoped idempotency key and ensures the notification exists', async () => {
    tx.appointmentEvent.findFirst.mockResolvedValueOnce({
      appointmentId: 'ar_confirmed',
      toState: 'confirmed_shared',
      actorAccountId: 'ck_a',
      actorRole: 'provider',
      reason: 'confirmed_by_a',
    });
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_confirmed',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'confirmed_shared',
    });

    const result = await confirmAppointment(tx as never, {
      actorAccountId: 'ck_a',
      requestId: 'ar_confirmed',
      idempotencyKey: 'msg_confirmed',
    });

    expect(result).toEqual({ id: 'ar_confirmed', status: 'confirmed_shared' });
    expect(tx.appointmentEvent.findFirst).toHaveBeenCalledWith({
      where: {
        appointmentId: 'ar_confirmed',
        actorAccountId: 'ck_a',
        actorRole: 'provider',
        toState: 'confirmed_shared',
        reason: 'confirmed_by_a',
        idempotencyKey: 'msg_confirmed',
      },
    });
    expect(tx.appointmentRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
    expect(tx.schedulingNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appointmentId: 'ar_confirmed',
        recipientAccountId: 'ck_b',
        idempotencyKey: 'appt:ar_confirmed:confirmed:B',
        kind: 'appointment_confirmed',
      }),
    });
  });

  it('does not replay transition idempotency keys across a different request or action', async () => {
    tx.appointmentEvent.findFirst.mockResolvedValueOnce(null);
    tx.appointmentRequest.findFirst.mockResolvedValueOnce(null);

    await expect(
      confirmAppointment(tx as never, {
        actorAccountId: 'ck_a',
        requestId: 'ar_other',
        idempotencyKey: 'msg_reused',
      }),
    ).rejects.toThrow('appointment_not_found');

    expect(tx.appointmentEvent.findFirst).toHaveBeenCalledWith({
      where: {
        appointmentId: 'ar_other',
        actorAccountId: 'ck_a',
        actorRole: 'provider',
        toState: 'confirmed_shared',
        reason: 'confirmed_by_a',
        idempotencyKey: 'msg_reused',
      },
    });
    expect(tx.appointmentRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.schedulingNotification.create).not.toHaveBeenCalled();
  });

  it('does not emit a cancel event when the observed state is stale before update', async () => {
    tx.appointmentRequest.findFirst.mockResolvedValueOnce({
      id: 'ar_stale',
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
      status: 'pending_held',
    });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      cancelAppointment(tx as never, {
        actorAccountId: 'ck_b',
        requestId: 'ar_stale',
        idempotencyKey: 'msg_stale',
      }),
    ).rejects.toThrow('appointment_not_found');

    expect(tx.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ar_stale',
        status: 'pending_held',
        OR: [
          { providerAccountId: 'ck_b' },
          { consumerAccountId: 'ck_b' },
        ],
      },
      data: { status: 'released', releaseReason: 'cancelled_by_b', releasedAt: expect.any(Date) },
    });
    expect(tx.appointmentEvent.create).not.toHaveBeenCalled();
  });

  it('lists pending requests for A with requester identity and hold age instead of TTL', async () => {
    tx.appointmentRequest.findMany.mockResolvedValueOnce([
      {
        id: 'ar_1',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        consumer: { displayName: 'Student B' },
        instanceStart: new Date('2026-06-02T11:00:00.000Z'),
        instanceEnd: new Date('2026-06-02T13:00:00.000Z'),
      },
    ]);

    const result = await listPendingRequests(tx as never, {
      providerAccountId: 'ck_a',
      now: new Date('2026-06-01T03:00:00.000Z'),
    });

    expect(result[0]).toMatchObject({
      id: 'ar_1',
      requesterDisplayName: 'Student B',
      holdAgeMinutes: 180,
      instanceStart: '2026-06-02T11:00:00.000Z',
      instanceEnd: '2026-06-02T13:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    expect(result[0]).not.toHaveProperty('expiresAt');
    expect(result[0]).not.toHaveProperty('holdExpiresAt');
  });
});
