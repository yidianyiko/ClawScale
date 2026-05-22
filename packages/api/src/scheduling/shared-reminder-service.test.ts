import { describe, expect, it, vi } from 'vitest';
import {
  acceptSharedReminder,
  cancelSharedReminder,
  createSharedReminder,
  rejectSharedReminder,
} from './shared-reminder-service.js';

function fakeSharedReminderClient(state: {
  friendship?: Record<string, unknown> | null;
  sharedReminderRequest?: Record<string, unknown> | null;
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
    expect(reminderRuntime.createRuntimeReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'acct_a',
        metadata: expect.objectContaining({ projection_role: 'invitee' }),
      }),
    );
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
      where: { id: 'srr_1', status: 'pending_invitee_confirmation', inviteeAccountId: 'acct_a' },
      data: { status: 'accepted', resolvedAt: expect.any(Date) },
    });
    expect(client.sharedReminderRequest.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'srr_1', status: 'accepted', inviteeAccountId: 'acct_a', inviteeReminderId: null },
      data: { status: 'pending_invitee_confirmation', resolvedAt: null },
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
      where: { id: 'srr_1', status: 'pending_invitee_confirmation' },
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
});
