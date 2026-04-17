import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  parkedInbound: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  agentBinding: {
    findUnique: vi.fn(),
  },
}));

const routeInboundMessage = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/route-message.js', () => ({ routeInboundMessage }));

import { replayParkedInbounds } from './replay-parked-inbounds.js';

describe('replayParkedInbounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    db.parkedInbound.findMany.mockResolvedValue([
      {
        id: 'pi_ready',
        channelId: 'ch_1',
        payload: {
          customerId: 'ck_ready',
          externalId: 'wxid_ready',
          displayName: 'Ready',
          text: 'hello ready',
        },
      },
      {
        id: 'pi_pending',
        channelId: 'ch_1',
        payload: {
          customerId: 'ck_pending',
          externalId: 'wxid_pending',
          displayName: 'Pending',
          text: 'hello pending',
        },
      },
      {
        id: 'pi_error',
        channelId: 'ch_1',
        payload: {
          customerId: 'ck_error',
          externalId: 'wxid_error',
          displayName: 'Error',
        },
      },
    ]);

    db.agentBinding.findUnique.mockImplementation(async ({ where }: { where: { customerId: string } }) => {
      if (where.customerId === 'ck_ready') {
        return { provisionStatus: 'ready', provisionLastError: null };
      }

      if (where.customerId === 'ck_pending') {
        return { provisionStatus: 'pending', provisionLastError: 'still provisioning' };
      }

      if (where.customerId === 'ck_error') {
        return { provisionStatus: 'error', provisionLastError: 'agent timed out' };
      }

      return null;
    });

    db.parkedInbound.update.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      status: 'drained',
      drainedAt: new Date('2026-04-17T00:00:10.000Z'),
    }));

    routeInboundMessage.mockResolvedValue({ conversationId: 'conv_1', reply: 'ok' });
  });

  it('drains only ready parked inbounds and keeps terminal errors visible', async () => {
    const summary = await replayParkedInbounds();

    expect(summary).toEqual({
      scanned: 3,
      replayed: 1,
      skipped: 2,
      terminalErrors: ['agent_binding_terminal_error:ck_error:agent timed out'],
    });
    expect(routeInboundMessage).toHaveBeenCalledTimes(1);
    expect(routeInboundMessage).toHaveBeenCalledWith({
      channelId: 'ch_1',
      externalId: 'wxid_ready',
      displayName: 'Ready',
      text: 'hello ready',
    });
    expect(db.parkedInbound.update).toHaveBeenCalledTimes(1);
    expect(db.parkedInbound.update).toHaveBeenCalledWith({
      where: { id: 'pi_ready' },
      data: {
        status: 'drained',
        drainedAt: expect.any(Date),
      },
    });
  });
});
