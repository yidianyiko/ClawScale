import { describe, expect, it, vi } from 'vitest';
import {
  acceptSharedReminder,
  cancelSharedReminder,
  createSharedReminder,
  expireDueSharedReminders,
  listPendingSharedReminders,
  rejectSharedReminder,
} from './shared-reminder-service.js';

function fakeSharedReminderClient(state: {
  friendship?: Record<string, unknown> | null;
  sharedReminderRequest?: Record<string, unknown> | null;
  reminderProjection?: Record<string, unknown> | null;
}) {
  return {
    friendship: {
      findFirst: vi.fn().mockResolvedValue(state.friendship ?? null),
    },
    sharedReminderRequest: {
      create: vi.fn().mockResolvedValue({
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'pending_invitee_confirmation',
      }),
      findFirst: vi.fn().mockResolvedValue(state.sharedReminderRequest ?? null),
      findMany: vi.fn().mockResolvedValue(state.sharedReminderRequest ? [state.sharedReminderRequest] : []),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sharedReminderEvent: {
      create: vi.fn().mockResolvedValue({ id: 'sre_1' }),
    },
    reminderProjection: {
      create: vi.fn().mockResolvedValue({ id: 'rp_1' }),
      findFirst: vi.fn().mockResolvedValue(state.reminderProjection ?? null),
    },
    productNotification: {
      create: vi.fn().mockResolvedValue({ id: 'pn_1' }),
    },
  };
}

function fakeReminderRuntime(state: {
  create?: { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
  cancel?: { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
}) {
  return {
    createRuntimeReminder: vi.fn().mockResolvedValue(state.create ?? { ok: true, data: { id: 'rem_1' } }),
    cancelRuntimeReminder: vi.fn().mockResolvedValue(state.cancel ?? { ok: true, data: { id: 'rem_1' } }),
  };
}

describe('shared reminder service', () => {
  it('creates requester projection immediately and notifies invitee', async () => {
    const client = fakeSharedReminderClient({
      friendship: { id: 'fs_1', accountAId: 'acct_a', accountBId: 'acct_b', status: 'active' },
    });
    const reminderRuntime = fakeReminderRuntime({
      create: { ok: true, data: { id: 'rem_req_1' } },
    });

    const result = await createSharedReminder(client as never, reminderRuntime, {
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      title: 'meeting',
      fireAt: '2026-05-22T07:00:00.000Z',
      timezone: 'Asia/Shanghai',
      idempotencyKey: 'shared:1',
    });

    expect(result.status).toBe('pending_invitee_confirmation');
    expect(reminderRuntime.createRuntimeReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'acct_b',
        title: 'meeting',
        localDate: '2026-05-22',
        localTime: '15:00',
        metadata: expect.objectContaining({
          projection_role: 'requester',
          counterparty_account_id: 'acct_a',
        }),
      }),
    );
    expect(client.productNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientAccountId: 'acct_a',
        kind: 'shared_reminder_request',
      }),
    });
  });

  it('cancels the request when requester projection creation fails', async () => {
    const client = fakeSharedReminderClient({
      friendship: { id: 'fs_1', accountAId: 'acct_a', accountBId: 'acct_b', status: 'active' },
    });
    const reminderRuntime = fakeReminderRuntime({
      create: { ok: false, error: 'reminder_bridge_transport_failed' },
    });

    await expect(
      createSharedReminder(client as never, reminderRuntime, {
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: '2026-05-22T07:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'shared:2',
      }),
    ).rejects.toThrow('reminder_projection_failed');

    expect(client.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'srr_1' }),
      data: { status: 'cancelled', resolvedAt: expect.any(Date) },
    });
  });

  it('cancels orphaned requester runtime reminder when requester projection persistence fails', async () => {
    const client = fakeSharedReminderClient({
      friendship: { id: 'fs_1', accountAId: 'acct_a', accountBId: 'acct_b', status: 'active' },
    });
    client.reminderProjection.create.mockRejectedValueOnce(new Error('db down'));
    const reminderRuntime = fakeReminderRuntime({
      create: { ok: true, data: { id: 'rem_req_1' } },
      cancel: { ok: true, data: { id: 'rem_req_1' } },
    });

    await expect(
      createSharedReminder(client as never, reminderRuntime, {
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: '2026-05-22T07:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'shared:projection-db-fail',
      }),
    ).rejects.toThrow('reminder_projection_failed');

    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_1',
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'srr_1' }),
      data: { status: 'cancelled', resolvedAt: expect.any(Date) },
    });
  });

  it('returns an existing shared reminder request on duplicate create retry without side effects', async () => {
    const existingRequest = {
      id: 'srr_existing',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      requesterReminderId: 'rem_req_existing',
      title: 'meeting',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      timezone: 'Asia/Shanghai',
      status: 'pending_invitee_confirmation',
      idempotencyKey: 'shared:retry',
    };
    const client = fakeSharedReminderClient({
      friendship: { id: 'fs_1', accountAId: 'acct_a', accountBId: 'acct_b', status: 'active' },
      sharedReminderRequest: existingRequest,
    });
    client.sharedReminderRequest.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      createSharedReminder(client as never, reminderRuntime, {
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: '2026-05-22T07:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'shared:retry',
      }),
    ).resolves.toMatchObject({ id: 'srr_existing', requesterReminderId: 'rem_req_existing' });

    expect(client.sharedReminderRequest.findFirst).toHaveBeenCalledWith({
      where: {
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        idempotencyKey: 'shared:retry',
      },
    });
    expect(reminderRuntime.createRuntimeReminder).not.toHaveBeenCalled();
    expect(client.productNotification.create).not.toHaveBeenCalled();
  });

  it('reconciles requester projection on duplicate create when request row missed requesterReminderId', async () => {
    const existingRequest = {
      id: 'srr_existing',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      requesterReminderId: null,
      title: 'meeting',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      timezone: 'Asia/Shanghai',
      status: 'pending_invitee_confirmation',
      idempotencyKey: 'shared:retry-missing-requester-id',
    };
    const client = fakeSharedReminderClient({
      friendship: { id: 'fs_1', accountAId: 'acct_a', accountBId: 'acct_b', status: 'active' },
      sharedReminderRequest: existingRequest,
      reminderProjection: {
        id: 'rp_req_1',
        sharedReminderRequestId: 'srr_existing',
        ownerAccountId: 'acct_b',
        runtimeReminderId: 'rem_req_existing',
        role: 'requester',
      },
    });
    client.sharedReminderRequest.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      createSharedReminder(client as never, reminderRuntime, {
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: '2026-05-22T07:00:00.000Z',
        timezone: 'Asia/Shanghai',
        idempotencyKey: 'shared:retry-missing-requester-id',
      }),
    ).resolves.toMatchObject({
      id: 'srr_existing',
      requesterReminderId: 'rem_req_existing',
    });

    expect(client.reminderProjection.findFirst).toHaveBeenCalledWith({
      where: { sharedReminderRequestId: 'srr_existing', role: 'requester' },
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'srr_existing',
        status: 'pending_invitee_confirmation',
        requesterReminderId: null,
      },
      data: { requesterReminderId: 'rem_req_existing' },
    });
    expect(reminderRuntime.createRuntimeReminder).not.toHaveBeenCalled();
    expect(client.productNotification.create).not.toHaveBeenCalled();
  });

  it('accepts before fire time and creates invitee projection', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      create: { ok: true, data: { id: 'rem_inv_1' } },
    });

    const result = await acceptSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_a',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'accept-srr-1',
    });

    expect(result.status).toBe('accepted');
    expect(client.sharedReminderRequest.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        OR: [
          { resolvedAt: null },
          { resolvedAt: { lt: new Date('2026-05-22T05:55:00.000Z') } },
        ],
      },
      data: { resolvedAt: expect.any(Date) },
    });
    expect(reminderRuntime.createRuntimeReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'acct_a',
        localDate: '2026-05-22',
        localTime: '15:00',
        metadata: expect.objectContaining({ projection_role: 'invitee' }),
      }),
    );
    expect(client.sharedReminderRequest.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        resolvedAt: expect.any(Date),
      },
      data: { status: 'accepted', inviteeReminderId: 'rem_inv_1' },
    });
  });

  it('does not create duplicate invitee runtime reminder when accept loses a race to an accepted request', async () => {
    const pendingRequest = {
      id: 'srr_1',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      title: 'meeting',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      timezone: 'Asia/Shanghai',
      status: 'pending_invitee_confirmation',
    };
    const acceptedRequest = { ...pendingRequest, status: 'accepted', inviteeReminderId: 'rem_inv_1' };
    const client = fakeSharedReminderClient({ sharedReminderRequest: pendingRequest });
    client.sharedReminderRequest.findFirst
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(acceptedRequest);
    client.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      acceptSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'accept-race-srr-1',
      }),
    ).resolves.toEqual({ id: 'srr_1', status: 'accepted' });

    expect(reminderRuntime.createRuntimeReminder).not.toHaveBeenCalled();
  });

  it('accept retry returns accepted without creating another runtime reminder', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        inviteeReminderId: 'rem_inv_1',
        title: 'meeting',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'accepted',
      },
    });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      acceptSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'accept-retry-srr-1',
      }),
    ).resolves.toEqual({ id: 'srr_1', status: 'accepted' });

    expect(reminderRuntime.createRuntimeReminder).not.toHaveBeenCalled();
  });

  it('rolls back accepted state when invitee projection creation fails', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      create: { ok: false, error: 'reminder_bridge_transport_failed' },
    });

    await expect(
      acceptSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'accept-fail-srr-1',
      }),
    ).rejects.toThrow('reminder_projection_failed');

    expect(client.sharedReminderRequest.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        OR: [
          { resolvedAt: null },
          { resolvedAt: { lt: new Date('2026-05-22T05:55:00.000Z') } },
        ],
      },
      data: { resolvedAt: expect.any(Date) },
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        resolvedAt: expect.any(Date),
      },
      data: { resolvedAt: null },
    });
  });

  it('cancels orphaned invitee runtime reminder and rolls back claim when invitee projection persistence fails', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'pending_invitee_confirmation',
      },
    });
    client.reminderProjection.create.mockRejectedValueOnce(new Error('db down'));
    const reminderRuntime = fakeReminderRuntime({
      create: { ok: true, data: { id: 'rem_inv_1' } },
      cancel: { ok: true, data: { id: 'rem_inv_1' } },
    });

    await expect(
      acceptSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'accept-projection-db-fail-srr-1',
      }),
    ).rejects.toThrow('reminder_projection_failed');

    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_a',
      reminderId: 'rem_inv_1',
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        resolvedAt: expect.any(Date),
      },
      data: { resolvedAt: null },
    });
  });

  it('stale accept retry reuses existing invitee projection and finalizes accepted', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'pending_invitee_confirmation',
        resolvedAt: new Date('2026-05-22T05:50:00.000Z'),
      },
      reminderProjection: {
        id: 'rp_inv_1',
        sharedReminderRequestId: 'srr_1',
        ownerAccountId: 'acct_a',
        runtimeReminderId: 'rem_inv_existing',
        role: 'invitee',
      },
    });
    const reminderRuntime = fakeReminderRuntime({});

    const result = await acceptSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_a',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'accept-stale-existing-projection-srr-1',
    });

    expect(result.status).toBe('accepted');
    expect(client.reminderProjection.findFirst).toHaveBeenCalledWith({
      where: { sharedReminderRequestId: 'srr_1', role: 'invitee' },
    });
    expect(reminderRuntime.createRuntimeReminder).not.toHaveBeenCalled();
    expect(client.sharedReminderRequest.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        resolvedAt: new Date('2026-05-22T06:00:00.000Z'),
      },
      data: { status: 'accepted', inviteeReminderId: 'rem_inv_existing' },
    });
  });

  it('accept race reconciles unique invitee projection conflict and cancels new runtime reminder', async () => {
    const existingProjection = {
      id: 'rp_inv_1',
      sharedReminderRequestId: 'srr_1',
      ownerAccountId: 'acct_a',
      runtimeReminderId: 'rem_inv_existing',
      role: 'invitee',
    };
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        title: 'meeting',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        timezone: 'Asia/Shanghai',
        status: 'pending_invitee_confirmation',
      },
      reminderProjection: null,
    });
    client.reminderProjection.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingProjection);
    client.reminderProjection.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    const reminderRuntime = fakeReminderRuntime({
      create: { ok: true, data: { id: 'rem_inv_new' } },
      cancel: { ok: true, data: { id: 'rem_inv_new' } },
    });

    const result = await acceptSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_a',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'accept-unique-projection-race-srr-1',
    });

    expect(result.status).toBe('accepted');
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_a',
      reminderId: 'rem_inv_new',
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        resolvedAt: new Date('2026-05-22T06:00:00.000Z'),
      },
      data: { status: 'accepted', inviteeReminderId: 'rem_inv_existing' },
    });
  });

  it('rejecting before fire time cancels requester projection', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: 'rem_req_1',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: true, data: { id: 'rem_req_1' } },
    });

    await rejectSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_a',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'reject-srr-1',
    });

    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_1',
    });
  });

  it('rejecting cancels requester projection found from projection row when request id is missing', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: null,
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
      reminderProjection: {
        id: 'rp_req_1',
        sharedReminderRequestId: 'srr_1',
        ownerAccountId: 'acct_b',
        runtimeReminderId: 'rem_req_from_projection',
        role: 'requester',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: true, data: { id: 'rem_req_from_projection' } },
    });

    await rejectSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_a',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'reject-projection-fallback-srr-1',
    });

    expect(client.reminderProjection.findFirst).toHaveBeenCalledWith({
      where: { sharedReminderRequestId: 'srr_1', role: 'requester' },
    });
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_from_projection',
    });
  });

  it('rejecting tolerates already-terminal requester projection cancellation', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: 'rem_req_1',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: false, error: 'invalid_reminder' },
    });

    const result = await rejectSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_a',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'reject-terminal-srr-1',
    });

    expect(result.status).toBe('rejected');
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_1',
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        resolvedAt: expect.any(Date),
      },
      data: { status: 'rejected' },
    });
  });

  it('does not mark rejected when requester projection cancellation fails', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: 'rem_req_1',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: false, error: 'reminder_bridge_transport_failed' },
    });

    await expect(
      rejectSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'reject-fail-srr-1',
      }),
    ).rejects.toThrow('reminder_projection_failed');

    expect(client.sharedReminderRequest.updateMany).not.toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'pending_invitee_confirmation', inviteeAccountId: 'acct_a' },
      data: { status: 'rejected', resolvedAt: expect.any(Date) },
    });
  });

  it('does not cancel requester projection when reject loses the pending claim', async () => {
    const pendingRequest = {
      id: 'srr_1',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      requesterReminderId: 'rem_req_1',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      status: 'pending_invitee_confirmation',
    };
    const client = fakeSharedReminderClient({ sharedReminderRequest: pendingRequest });
    client.sharedReminderRequest.findFirst
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce({ ...pendingRequest, status: 'accepted', inviteeReminderId: 'rem_inv_1' });
    client.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      rejectSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'reject-lost-srr-1',
      }),
    ).rejects.toThrow('shared_reminder_not_found');

    expect(reminderRuntime.cancelRuntimeReminder).not.toHaveBeenCalled();
  });

  it('does not cancel requester projection when reject sees a fresh in-flight claim', async () => {
    const freshClaim = new Date('2026-05-22T05:59:00.000Z');
    const pendingRequest = {
      id: 'srr_1',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      requesterReminderId: 'rem_req_1',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      status: 'pending_invitee_confirmation',
      resolvedAt: freshClaim,
    };
    const client = fakeSharedReminderClient({ sharedReminderRequest: pendingRequest });
    client.sharedReminderRequest.findFirst
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(pendingRequest);
    client.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      rejectSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'reject-fresh-claim-srr-1',
      }),
    ).rejects.toThrow('shared_reminder_not_found');

    expect(reminderRuntime.cancelRuntimeReminder).not.toHaveBeenCalled();
  });

  it('reclaims a stale pending claim before rejecting and cancelling requester projection', async () => {
    const staleClaim = new Date('2026-05-22T05:50:00.000Z');
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: 'rem_req_1',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
        resolvedAt: staleClaim,
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: true, data: { id: 'rem_req_1' } },
    });

    await rejectSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_a',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'reject-stale-claim-srr-1',
    });

    expect(client.sharedReminderRequest.updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        inviteeAccountId: 'acct_a',
        OR: [
          { resolvedAt: null },
          { resolvedAt: { lt: new Date('2026-05-22T05:55:00.000Z') } },
        ],
      }),
      data: { resolvedAt: new Date('2026-05-22T06:00:00.000Z') },
    });
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_1',
    });
  });

  it('accepting after fire time marks the request expired and creates no invitee projection', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      acceptSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_a',
        requestId: 'srr_1',
        now: new Date('2026-05-22T07:01:00.000Z'),
        idempotencyKey: 'accept-late-srr-1',
      }),
    ).rejects.toThrow('shared_reminder_due');

    expect(reminderRuntime.createRuntimeReminder).not.toHaveBeenCalled();
    expect(client.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        OR: [
          { resolvedAt: null },
          { resolvedAt: { lt: new Date('2026-05-22T06:56:00.000Z') } },
        ],
      },
      data: { status: 'expired', resolvedAt: expect.any(Date) },
    });
  });

  it('canceling before fire time cancels requester projection', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: 'rem_req_1',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: true, data: { id: 'rem_req_1' } },
    });

    const result = await cancelSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_b',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'cancel-srr-1',
    });

    expect(result.status).toBe('cancelled');
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_1',
    });
  });

  it('canceling cancels requester projection found from projection row when request id is missing', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: null,
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
      reminderProjection: {
        id: 'rp_req_1',
        sharedReminderRequestId: 'srr_1',
        ownerAccountId: 'acct_b',
        runtimeReminderId: 'rem_req_from_projection',
        role: 'requester',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: true, data: { id: 'rem_req_from_projection' } },
    });

    await cancelSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_b',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'cancel-projection-fallback-srr-1',
    });

    expect(client.reminderProjection.findFirst).toHaveBeenCalledWith({
      where: { sharedReminderRequestId: 'srr_1', role: 'requester' },
    });
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_from_projection',
    });
  });

  it('canceling tolerates already-terminal requester projection cancellation', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: 'rem_req_1',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
      },
    });
    const reminderRuntime = fakeReminderRuntime({
      cancel: { ok: false, error: 'invalid_reminder' },
    });

    const result = await cancelSharedReminder(client as never, reminderRuntime, {
      actorAccountId: 'acct_b',
      requestId: 'srr_1',
      now: new Date('2026-05-22T06:00:00.000Z'),
      idempotencyKey: 'cancel-terminal-srr-1',
    });

    expect(result.status).toBe('cancelled');
    expect(reminderRuntime.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'acct_b',
      reminderId: 'rem_req_1',
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        requesterAccountId: 'acct_b',
        resolvedAt: expect.any(Date),
      },
      data: { status: 'cancelled' },
    });
  });

  it('does not cancel requester projection when cancel loses the pending claim', async () => {
    const pendingRequest = {
      id: 'srr_1',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      requesterReminderId: 'rem_req_1',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      status: 'pending_invitee_confirmation',
    };
    const client = fakeSharedReminderClient({ sharedReminderRequest: pendingRequest });
    client.sharedReminderRequest.findFirst
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce({ ...pendingRequest, status: 'accepted', inviteeReminderId: 'rem_inv_1' });
    client.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      cancelSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_b',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'cancel-lost-srr-1',
      }),
    ).rejects.toThrow('shared_reminder_not_found');

    expect(reminderRuntime.cancelRuntimeReminder).not.toHaveBeenCalled();
  });

  it('does not cancel requester projection when cancel sees a fresh in-flight claim', async () => {
    const freshClaim = new Date('2026-05-22T05:59:00.000Z');
    const pendingRequest = {
      id: 'srr_1',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      requesterReminderId: 'rem_req_1',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      status: 'pending_invitee_confirmation',
      resolvedAt: freshClaim,
    };
    const client = fakeSharedReminderClient({ sharedReminderRequest: pendingRequest });
    client.sharedReminderRequest.findFirst
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(pendingRequest);
    client.sharedReminderRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      cancelSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_b',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'cancel-fresh-claim-srr-1',
      }),
    ).rejects.toThrow('shared_reminder_not_found');

    expect(reminderRuntime.cancelRuntimeReminder).not.toHaveBeenCalled();
  });

  it('does not cancel an accepted shared reminder or invitee projection', async () => {
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        requesterReminderId: 'rem_req_1',
        inviteeReminderId: 'rem_inv_1',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'accepted',
      },
    });
    const reminderRuntime = fakeReminderRuntime({});

    await expect(
      cancelSharedReminder(client as never, reminderRuntime, {
        actorAccountId: 'acct_b',
        requestId: 'srr_1',
        now: new Date('2026-05-22T06:00:00.000Z'),
        idempotencyKey: 'cancel-accepted-srr-1',
      }),
    ).rejects.toThrow('shared_reminder_not_pending');

    expect(client.sharedReminderRequest.updateMany).not.toHaveBeenCalledWith({
      where: { id: 'srr_1', status: 'accepted', requesterAccountId: 'acct_b' },
      data: { status: 'cancelled', resolvedAt: expect.any(Date) },
    });
    expect(reminderRuntime.cancelRuntimeReminder).not.toHaveBeenCalledWith({
      customerId: 'acct_a',
      reminderId: 'rem_inv_1',
    });
  });

  it('expires due unclaimed and stale-claimed pending shared reminders', async () => {
    const now = new Date('2026-05-22T07:01:00.000Z');
    const client = fakeSharedReminderClient({
      sharedReminderRequest: {
        id: 'srr_1',
        requesterAccountId: 'acct_b',
        inviteeAccountId: 'acct_a',
        fireAt: new Date('2026-05-22T07:00:00.000Z'),
        status: 'pending_invitee_confirmation',
        resolvedAt: new Date('2026-05-22T06:50:00.000Z'),
      },
    });

    const result = await expireDueSharedReminders(client as never, { now });

    expect(result).toEqual({ count: 1 });
    expect(client.sharedReminderRequest.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending_invitee_confirmation',
        fireAt: { lte: now },
        OR: [
          { resolvedAt: null },
          { resolvedAt: { lt: new Date('2026-05-22T06:56:00.000Z') } },
        ],
      },
      orderBy: { fireAt: 'asc' },
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'srr_1',
        status: 'pending_invitee_confirmation',
        OR: [
          { resolvedAt: null },
          { resolvedAt: { lt: new Date('2026-05-22T06:56:00.000Z') } },
        ],
      },
      data: { status: 'expired', resolvedAt: now },
    });
  });

  it('does not expire fresh-claimed pending shared reminders', async () => {
    const now = new Date('2026-05-22T07:01:00.000Z');
    const client = fakeSharedReminderClient({ sharedReminderRequest: null });

    const result = await expireDueSharedReminders(client as never, { now });

    expect(result).toEqual({ count: 0 });
    expect(client.sharedReminderRequest.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending_invitee_confirmation',
        fireAt: { lte: now },
        OR: [
          { resolvedAt: null },
          { resolvedAt: { lt: new Date('2026-05-22T06:56:00.000Z') } },
        ],
      },
      orderBy: { fireAt: 'asc' },
    });
    expect(client.sharedReminderRequest.updateMany).not.toHaveBeenCalled();
  });

  it('lists pending shared reminders for an invitee', async () => {
    const pending = {
      id: 'srr_1',
      requesterAccountId: 'acct_b',
      inviteeAccountId: 'acct_a',
      title: 'meeting',
      fireAt: new Date('2026-05-22T07:00:00.000Z'),
      timezone: 'Asia/Shanghai',
      status: 'pending_invitee_confirmation',
    };
    const client = fakeSharedReminderClient({ sharedReminderRequest: pending });

    await expect(
      listPendingSharedReminders(client as never, { inviteeAccountId: 'acct_a' }),
    ).resolves.toEqual([pending]);

    expect(client.sharedReminderRequest.findMany).toHaveBeenCalledWith({
      where: {
        inviteeAccountId: 'acct_a',
        status: 'pending_invitee_confirmation',
      },
      orderBy: { createdAt: 'desc' },
    });
  });
});
