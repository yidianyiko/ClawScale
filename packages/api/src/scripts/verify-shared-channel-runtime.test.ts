import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  agentBinding: {
    findMany: vi.fn(),
  },
  parkedInbound: {
    findMany: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => ({ db }));

import { verifySharedChannelRuntime } from './verify-shared-channel-runtime.js';

describe('verifySharedChannelRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.agentBinding.findMany.mockResolvedValue([
      {
        customerId: 'ck_ready',
        provisionStatus: 'ready',
        provisionLastError: null,
      },
      {
        customerId: 'ck_pending',
        provisionStatus: 'pending',
        provisionLastError: 'still provisioning',
      },
      {
        customerId: 'ck_error',
        provisionStatus: 'error',
        provisionLastError: 'agent timed out',
      },
    ]);
    db.parkedInbound.findMany.mockResolvedValue([
      {
        id: 'pi_missing_customer',
        channelId: 'ch_1',
        payload: {},
      },
      {
        id: 'pi_missing_binding',
        channelId: 'ch_1',
        payload: { customerId: 'ck_missing' },
      },
      {
        id: 'pi_ready_still_queued',
        channelId: 'ch_1',
        payload: { customerId: 'ck_ready' },
      },
      {
        id: 'pi_terminal',
        channelId: 'ch_1',
        payload: { customerId: 'ck_error' },
      },
    ]);
  });

  it('reports shared-channel runtime counts, assumptions, and queued-row error states', async () => {
    const summary = await verifySharedChannelRuntime();

    expect(summary).toEqual({
      deliveryPathAssumptions: [
        'delivery_route_truth_is_clawscale_owned',
        'exact_delivery_route_channel_id_is_authoritative',
        'failed_shared_channel_reclaims_do_not_reroute_to_a_different_channel',
      ],
      counts: {
        queuedParkedInbounds: 4,
        readyBindings: 1,
        pendingBindings: 1,
        errorBindings: 1,
      },
      errors: [
        'parked_inbound_missing_customer_id:pi_missing_customer:channel=ch_1',
        'parked_inbound_missing_binding:pi_missing_binding:ck_missing',
        'parked_inbound_still_queued:pi_ready_still_queued:ck_ready',
        'parked_inbound_blocked_by_terminal_error:pi_terminal:ck_error',
        'agent_binding_terminal_error:ck_error:agent timed out',
      ],
      terminalErrors: ['agent_binding_terminal_error:ck_error:agent timed out'],
    });
  });

  it('passes through the replay limit to queued parked-inbound verification', async () => {
    await verifySharedChannelRuntime({ limit: 7 });

    expect(db.parkedInbound.findMany).toHaveBeenCalledWith({
      where: {
        status: 'queued',
      },
      select: {
        id: true,
        channelId: true,
        payload: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 7,
    });
  });
});
