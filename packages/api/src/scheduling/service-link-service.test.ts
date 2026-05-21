import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockServiceLink,
  createOrActivateServiceLink,
  removeServiceLink,
  unblockServiceLink,
} from './service-link-service.js';

const tx = {
  serviceLink: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  appointmentRequest: { updateMany: vi.fn() },
  schedulingNotification: { createMany: vi.fn() },
  $transaction: vi.fn(),
};

describe('service link service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tx.$transaction.mockImplementation(async (fn) => fn(tx));
  });

  it('is idempotent when an active link already exists', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({
      id: 'sl_1',
      status: 'active',
      capabilities: ['appointment_request'],
    });

    const result = await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(result.status).toBe('active');
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('reactivates a removed link instead of creating a duplicate row', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'removed', capabilities: [] })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active', capabilities: ['appointment_request'] });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 1 });

    await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'removed' },
      data: {
        status: 'active',
        removedAt: null,
        capabilities: ['appointment_request'],
      },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('does not reactivate a removed link when it concurrently becomes blocked', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'removed', capabilities: [] })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'blocked', capabilities: [] });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(result.status).toBe('blocked');
    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'removed' },
      data: {
        status: 'active',
        removedAt: null,
        capabilities: ['appointment_request'],
      },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('does not grant capability when a blocked link exists', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'blocked', capabilities: [] });

    const result = await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(result.status).toBe('blocked');
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('re-reads the existing service link when first creation loses a unique race', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active', capabilities: ['appointment_request'] });
    tx.serviceLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

    const result = await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(result.status).toBe('active');
    expect(tx.serviceLink.findFirst).toHaveBeenCalledTimes(2);
  });

  it('reactivates a concurrently-created removed link after a unique race', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'sl_1', status: 'removed', capabilities: [] })
      .mockResolvedValueOnce({
        id: 'sl_1',
        status: 'active',
        capabilities: ['appointment_request'],
      });
    tx.serviceLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 1 });

    await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'removed' },
      data: {
        status: 'active',
        removedAt: null,
        capabilities: ['appointment_request'],
      },
    });
  });

  it('blocking releases pending requests without revealing block reason', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active' })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'blocked' });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 2 });

    await blockServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', consumerAccountId: 'ck_b', status: 'pending_held' },
      data: { status: 'released', releaseReason: 'cancelled_by_a', releasedAt: expect.any(Date) },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });

  it('blocking an already blocked service link is idempotent', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'blocked' });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await blockServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(result.status).toBe('blocked');
    expect(tx.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', consumerAccountId: 'ck_b', status: 'pending_held' },
      data: { status: 'released', releaseReason: 'cancelled_by_a', releasedAt: expect.any(Date) },
    });
    expect(tx.serviceLink.updateMany).not.toHaveBeenCalled();
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });

  it('does not convert a removed service link to blocked', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'removed' });

    await expect(
      blockServiceLink(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
      }),
    ).rejects.toThrow('service_link_not_blockable');
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
    expect(tx.appointmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it('does not block a service link when it concurrently becomes removed', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active' })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'removed' });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      blockServiceLink(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
      }),
    ).rejects.toThrow('service_link_not_blockable');

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'active' },
      data: {
        status: 'blocked',
        blockedAt: expect.any(Date),
        capabilities: [],
      },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
    expect(tx.appointmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it('uses a transaction for blocking when the root client supports it', async () => {
    const txClient = {
      serviceLink: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      appointmentRequest: { updateMany: vi.fn() },
    };
    tx.$transaction.mockImplementationOnce(async (fn) => fn(txClient));
    txClient.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active' })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'blocked' });
    txClient.serviceLink.updateMany.mockResolvedValueOnce({ count: 1 });
    txClient.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 2 });

    await blockServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.$transaction).toHaveBeenCalledTimes(1);
    expect(txClient.serviceLink.updateMany).toHaveBeenCalled();
    expect(txClient.appointmentRequest.updateMany).toHaveBeenCalled();
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });

  it('unblocks an existing blocked service link', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'blocked', capabilities: [] })
      .mockResolvedValueOnce({
        id: 'sl_1',
        status: 'active',
        capabilities: ['appointment_request'],
      });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 1 });

    await unblockServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'blocked' },
      data: {
        status: 'active',
        blockedAt: null,
        capabilities: ['appointment_request'],
      },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('does not create a service link when unblock has no existing row', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce(null);

    await expect(
      unblockServiceLink(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
      }),
    ).rejects.toThrow('service_link_not_found');
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('does not reactivate a removed service link through unblock', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'removed', capabilities: [] });

    await expect(
      unblockServiceLink(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
      }),
    ).rejects.toThrow('service_link_not_blocked');
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('does not unblock a service link when it concurrently becomes active', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'blocked', capabilities: [] })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active', capabilities: ['appointment_request'] });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      unblockServiceLink(tx as never, {
        providerAccountId: 'ck_a',
        consumerAccountId: 'ck_b',
      }),
    ).rejects.toThrow('service_link_not_blocked');

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'blocked' },
      data: {
        status: 'active',
        blockedAt: null,
        capabilities: ['appointment_request'],
      },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
    expect(tx.serviceLink.create).not.toHaveBeenCalled();
  });

  it('removal is reversible and does not block future user-link flow', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active' })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'removed' });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 1 });
    await removeServiceLink(tx as never, { serviceLinkId: 'sl_1' });
    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'active' },
      data: { status: 'removed', removedAt: expect.any(Date) },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });

  it('removing an already removed service link is idempotent', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'removed' });

    const result = await removeServiceLink(tx as never, { serviceLinkId: 'sl_1' });

    expect(result.status).toBe('removed');
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });

  it('does not convert a blocked service link to removed', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'blocked' });

    await expect(removeServiceLink(tx as never, { serviceLinkId: 'sl_1' })).rejects.toThrow(
      'service_link_blocked',
    );
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });

  it('does not remove a service link when it concurrently becomes blocked', async () => {
    tx.serviceLink.findFirst
      .mockResolvedValueOnce({ id: 'sl_1', status: 'active' })
      .mockResolvedValueOnce({ id: 'sl_1', status: 'blocked' });
    tx.serviceLink.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(removeServiceLink(tx as never, { serviceLinkId: 'sl_1' })).rejects.toThrow(
      'service_link_blocked',
    );

    expect(tx.serviceLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'sl_1', status: 'active' },
      data: { status: 'removed', removedAt: expect.any(Date) },
    });
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });
});
