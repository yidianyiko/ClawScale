import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockServiceLink,
  createOrActivateServiceLink,
  removeServiceLink,
  unblockServiceLink,
} from './service-link-service.js';

const tx = {
  serviceLink: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'removed', capabilities: [] });
    tx.serviceLink.update.mockResolvedValueOnce({ id: 'sl_1', status: 'active', capabilities: ['appointment_request'] });

    await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.serviceLink.update).toHaveBeenCalledWith({
      where: { id: 'sl_1' },
      data: {
        status: 'active',
        removedAt: null,
        capabilities: ['appointment_request'],
      },
    });
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
      .mockResolvedValueOnce({ id: 'sl_1', status: 'removed', capabilities: [] });
    tx.serviceLink.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    tx.serviceLink.update.mockResolvedValueOnce({
      id: 'sl_1',
      status: 'active',
      capabilities: ['appointment_request'],
    });

    await createOrActivateServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.serviceLink.update).toHaveBeenCalledWith({
      where: { id: 'sl_1' },
      data: {
        status: 'active',
        removedAt: null,
        capabilities: ['appointment_request'],
      },
    });
  });

  it('blocking releases pending requests without revealing block reason', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'active' });
    tx.serviceLink.update.mockResolvedValueOnce({ id: 'sl_1', status: 'blocked' });
    tx.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 2 });

    await blockServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.appointmentRequest.updateMany).toHaveBeenCalledWith({
      where: { providerAccountId: 'ck_a', consumerAccountId: 'ck_b', status: 'pending_held' },
      data: { status: 'released', releaseReason: 'cancelled_by_a', releasedAt: expect.any(Date) },
    });
  });

  it('uses a transaction for blocking when the root client supports it', async () => {
    const txClient = {
      serviceLink: { findFirst: vi.fn(), update: vi.fn() },
      appointmentRequest: { updateMany: vi.fn() },
    };
    tx.$transaction.mockImplementationOnce(async (fn) => fn(txClient));
    txClient.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'active' });
    txClient.serviceLink.update.mockResolvedValueOnce({ id: 'sl_1', status: 'blocked' });
    txClient.appointmentRequest.updateMany.mockResolvedValueOnce({ count: 2 });

    await blockServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.$transaction).toHaveBeenCalledTimes(1);
    expect(txClient.serviceLink.update).toHaveBeenCalled();
    expect(txClient.appointmentRequest.updateMany).toHaveBeenCalled();
    expect(tx.serviceLink.update).not.toHaveBeenCalled();
  });

  it('unblocks an existing blocked service link', async () => {
    tx.serviceLink.findFirst.mockResolvedValueOnce({ id: 'sl_1', status: 'blocked', capabilities: [] });
    tx.serviceLink.update.mockResolvedValueOnce({
      id: 'sl_1',
      status: 'active',
      capabilities: ['appointment_request'],
    });

    await unblockServiceLink(tx as never, {
      providerAccountId: 'ck_a',
      consumerAccountId: 'ck_b',
    });

    expect(tx.serviceLink.update).toHaveBeenCalledWith({
      where: { id: 'sl_1' },
      data: {
        status: 'active',
        blockedAt: null,
        capabilities: ['appointment_request'],
      },
    });
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

  it('removal is reversible and does not block future user-link flow', async () => {
    tx.serviceLink.update.mockResolvedValueOnce({ id: 'sl_1', status: 'removed' });
    await removeServiceLink(tx as never, { serviceLinkId: 'sl_1' });
    expect(tx.serviceLink.update).toHaveBeenCalledWith({
      where: { id: 'sl_1' },
      data: { status: 'removed', removedAt: expect.any(Date) },
    });
  });
});
