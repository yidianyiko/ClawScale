import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  parkedInbound: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  agentBinding: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  agent: {
    findUnique: vi.fn(),
  },
}));

const routeInboundMessage = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/route-message.js', () => ({ routeInboundMessage }));

import { replayParkedInbounds } from './replay-parked-inbounds.js';

describe('replayParkedInbounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);

    db.parkedInbound.findMany.mockResolvedValue([
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
          text: 'hello error',
        },
      },
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
    ]);

    db.agentBinding.findUnique.mockImplementation(async ({ where }: { where: { customerId: string } }) => {
      if (where.customerId === 'ck_pending') {
        return {
          customerId: 'ck_pending',
          agentId: 'agent_shared',
          provisionStatus: 'pending',
          provisionAttempts: 0,
          provisionLastError: 'still provisioning',
          customer: { displayName: 'Pending' },
        };
      }

      if (where.customerId === 'ck_error') {
        return {
          customerId: 'ck_error',
          agentId: 'agent_shared',
          provisionStatus: 'error',
          provisionAttempts: 3,
          provisionLastError: 'agent timed out',
          customer: { displayName: 'Error' },
        };
      }

      if (where.customerId === 'ck_ready') {
        return {
          customerId: 'ck_ready',
          agentId: 'agent_shared',
          provisionStatus: 'ready',
          provisionAttempts: 1,
          provisionLastError: null,
          customer: { displayName: 'Ready' },
        };
      }

      return null;
    });

    db.agent.findUnique.mockResolvedValue({
      endpoint: 'https://agent.example/provision',
      authToken: 'secret-token',
    });

    db.agentBinding.update.mockResolvedValue({});
    db.parkedInbound.update.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      status: 'drained',
      drainedAt: new Date('2026-04-17T00:00:10.000Z'),
    }));

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    routeInboundMessage.mockResolvedValue({ conversationId: 'conv_1', reply: 'ok' });
  });

  it('retries pending bindings, drains only ready rows, and keeps terminal errors visible', async () => {
    const summary = await replayParkedInbounds();

    expect(summary).toEqual({
      scanned: 3,
      replayed: 2,
      skipped: 1,
      terminalErrors: ['agent_binding_terminal_error:ck_error:agent timed out'],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://agent.example/provision',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        }),
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          customer_id: 'ck_pending',
          display_name: 'Pending',
        }),
      }),
    );
    expect(db.agentBinding.update).toHaveBeenCalledWith({
      where: { customerId: 'ck_pending' },
      data: expect.objectContaining({
        provisionStatus: 'ready',
        provisionAttempts: { increment: 1 },
        provisionLastError: null,
        provisionUpdatedAt: expect.any(Date),
      }),
    });
    expect(routeInboundMessage).toHaveBeenNthCalledWith(1, {
      channelId: 'ch_1',
      externalId: 'wxid_pending',
      displayName: 'Pending',
      text: 'hello pending',
    });
    expect(routeInboundMessage).toHaveBeenNthCalledWith(2, {
      channelId: 'ch_1',
      externalId: 'wxid_ready',
      displayName: 'Ready',
      text: 'hello ready',
    });
    expect(db.parkedInbound.update).toHaveBeenCalledTimes(2);
    expect(db.parkedInbound.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'pi_pending' },
      data: {
        status: 'drained',
        drainedAt: expect.any(Date),
      },
    });
    expect(db.parkedInbound.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'pi_ready' },
      data: {
        status: 'drained',
        drainedAt: expect.any(Date),
      },
    });
  });

  it('promotes repeated replay failures to terminal error after the retry threshold', async () => {
    db.parkedInbound.findMany.mockResolvedValueOnce([
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
    ]);
    db.agentBinding.findUnique.mockResolvedValueOnce({
      customerId: 'ck_pending',
      agentId: 'agent_shared',
      provisionStatus: 'pending',
      provisionAttempts: 2,
      provisionLastError: 'still provisioning',
      customer: { displayName: 'Pending' },
    });
    fetchMock.mockRejectedValueOnce(new Error('network timeout'));

    const summary = await replayParkedInbounds();

    expect(summary).toEqual({
      scanned: 1,
      replayed: 0,
      skipped: 1,
      terminalErrors: ['agent_binding_terminal_error:ck_pending:network timeout'],
    });
    expect(db.agentBinding.update).toHaveBeenCalledWith({
      where: { customerId: 'ck_pending' },
      data: expect.objectContaining({
        provisionStatus: 'error',
        provisionAttempts: { increment: 1 },
        provisionLastError: 'network timeout',
        provisionUpdatedAt: expect.any(Date),
      }),
    });
    expect(routeInboundMessage).not.toHaveBeenCalled();
    expect(db.parkedInbound.update).not.toHaveBeenCalled();
  });
});
