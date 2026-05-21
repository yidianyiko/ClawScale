import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockServiceLink,
  createOrActivateServiceLink,
  removeServiceLink,
} from './service-link-service.js';

const tx = {
  serviceLink: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  appointmentRequest: { updateMany: vi.fn() },
  schedulingNotification: { createMany: vi.fn() },
};

describe('service link service', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('removal is reversible and does not block future user-link flow', async () => {
    tx.serviceLink.update.mockResolvedValueOnce({ id: 'sl_1', status: 'removed' });
    await removeServiceLink(tx as never, { serviceLinkId: 'sl_1' });
    expect(tx.serviceLink.update).toHaveBeenCalledWith({
      where: { id: 'sl_1' },
      data: { status: 'removed', removedAt: expect.any(Date) },
    });
  });
});
