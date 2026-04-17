import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const tx = {
    identity: { create: vi.fn() },
    customer: { create: vi.fn() },
    membership: { create: vi.fn() },
    agentBinding: { create: vi.fn() },
    externalIdentity: { create: vi.fn() },
  };

  const client = {
    externalIdentity: { findUnique: vi.fn(), update: vi.fn() },
    agentBinding: { findUnique: vi.fn(), update: vi.fn() },
    agent: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (txClient: typeof tx) => Promise<unknown>) => fn(tx)),
    __tx: tx,
  } as any;

  return client;
});

const queueParkedInbound = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('./parked-inbound.js', () => ({ queueParkedInbound }));

import { provisionSharedChannelCustomer } from './shared-channel-provisioning.js';

describe('provisionSharedChannelCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);

    db.$transaction.mockImplementation(async (fn: (txClient: typeof db.__tx) => Promise<unknown>) =>
      fn(db.__tx));
    db.externalIdentity.findUnique.mockResolvedValue(null);
    db.externalIdentity.update.mockResolvedValue({});
    db.agentBinding.findUnique.mockResolvedValue({
      customerId: 'ck_existing',
      provisionStatus: 'ready',
    });
    db.agentBinding.update.mockResolvedValue({});
    db.agent.findUnique.mockResolvedValue({
      id: 'agent_shared',
      endpoint: 'https://agent.example/provision',
      authToken: 'secret-token',
    });

    db.__tx.identity.create.mockResolvedValue({});
    db.__tx.customer.create.mockResolvedValue({});
    db.__tx.membership.create.mockResolvedValue({});
    db.__tx.agentBinding.create.mockResolvedValue({});
    db.__tx.externalIdentity.create.mockResolvedValue({});

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  it('routes an existing shared-channel customer on external identity lookup hit', async () => {
    db.externalIdentity.findUnique.mockResolvedValueOnce({ customerId: 'ck_existing' });

    await expect(
      provisionSharedChannelCustomer({
        channelId: 'ch_1',
        agentId: 'agent_shared',
        displayName: 'Alice',
        provider: 'whatsapp_business',
        identityType: 'wa_id',
        rawIdentityValue: '+1 (415) 555-0100',
        payload: {
          externalId: '+1 (415) 555-0100',
          text: 'hello',
        },
      }),
    ).resolves.toEqual({
      customerId: 'ck_existing',
      created: false,
      parked: false,
      provisionStatus: 'ready',
    });

    expect(db.externalIdentity.update).toHaveBeenCalledWith({
      where: {
        provider_identityType_identityValue: {
          provider: 'whatsapp_business',
          identityType: 'wa_id',
          identityValue: '14155550100',
        },
      },
      data: {
        lastSeenAt: expect.any(Date),
      },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueParkedInbound).not.toHaveBeenCalled();
  });

  it('creates the shared-channel platform graph on first inbound miss', async () => {
    const result = await provisionSharedChannelCustomer({
      channelId: 'ch_1',
      agentId: 'agent_shared',
      displayName: 'Alice',
      provider: 'whatsapp_business',
      identityType: 'wa_id',
      rawIdentityValue: '+1 (415) 555-0100',
      payload: {
        externalId: '+1 (415) 555-0100',
        text: 'hello',
      },
    });

    expect(result).toEqual({
      customerId: expect.stringMatching(/^ck_/),
      created: true,
      parked: false,
      provisionStatus: 'ready',
    });

    const customerCreateArgs = db.__tx.customer.create.mock.calls[0]?.[0];
    const customerId = customerCreateArgs?.data?.id;

    expect(db.__tx.identity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayName: 'Alice',
        claimStatus: 'unclaimed',
      }),
    });
    expect(customerCreateArgs).toEqual({
      data: expect.objectContaining({
        id: expect.stringMatching(/^ck_/),
        kind: 'personal',
        displayName: 'Alice',
      }),
    });
    expect(db.__tx.membership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId,
        role: 'owner',
      }),
    });
    expect(db.__tx.agentBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId,
        agentId: 'agent_shared',
        provisionStatus: 'pending',
      }),
    });
    expect(db.__tx.externalIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'whatsapp_business',
        identityType: 'wa_id',
        identityValue: '14155550100',
        customerId,
        firstSeenChannelId: 'ch_1',
      }),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://agent.example/provision',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          customer_id: customerId,
          display_name: 'Alice',
        }),
      }),
    );
    expect(db.agentBinding.update).toHaveBeenCalledWith({
      where: { customerId },
      data: expect.objectContaining({
        provisionStatus: 'ready',
        provisionAttempts: { increment: 1 },
        provisionLastError: null,
        provisionUpdatedAt: expect.any(Date),
      }),
    });
  });

  it('re-reads the winner after a concurrent unique-conflict on first inbound', async () => {
    const uniqueConflict = {
      code: 'P2002',
      meta: {
        target: ['provider', 'identityType', 'identityValue'],
      },
    };

    db.externalIdentity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ customerId: 'ck_existing' });
    db.$transaction.mockImplementationOnce(async (fn: (txClient: typeof db.__tx) => Promise<unknown>) => {
      await expect(fn(db.__tx)).rejects.toEqual(uniqueConflict);
      throw uniqueConflict;
    });
    db.__tx.externalIdentity.create.mockRejectedValueOnce(uniqueConflict);

    await expect(
      provisionSharedChannelCustomer({
        channelId: 'ch_1',
        agentId: 'agent_shared',
        displayName: 'Alice',
        provider: 'whatsapp_business',
        identityType: 'wa_id',
        rawIdentityValue: '+1 (415) 555-0100',
        payload: {
          externalId: '+1 (415) 555-0100',
          text: 'hello',
        },
      }),
    ).resolves.toEqual({
      customerId: 'ck_existing',
      created: false,
      parked: false,
      provisionStatus: 'ready',
    });

    expect(db.externalIdentity.findUnique).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueParkedInbound).not.toHaveBeenCalled();
  });

  it('parks the first inbound when shared-channel provisioning fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network timeout'));

    const result = await provisionSharedChannelCustomer({
      channelId: 'ch_1',
      agentId: 'agent_shared',
      displayName: 'Alice',
      provider: 'whatsapp_business',
      identityType: 'wa_id',
      rawIdentityValue: '+1 (415) 555-0100',
      payload: {
        externalId: '+1 (415) 555-0100',
        text: 'hello',
      },
    });

    const customerId = db.__tx.customer.create.mock.calls[0]?.[0]?.data?.id;

    expect(result).toEqual({
      customerId,
      created: true,
      parked: true,
      provisionStatus: 'pending',
    });
    expect(db.agentBinding.update).toHaveBeenCalledWith({
      where: { customerId },
      data: expect.objectContaining({
        provisionStatus: 'pending',
        provisionAttempts: { increment: 1 },
        provisionLastError: expect.stringContaining('network timeout'),
        provisionUpdatedAt: expect.any(Date),
      }),
    });
    expect(queueParkedInbound).toHaveBeenCalledWith({
      channelId: 'ch_1',
      provider: 'whatsapp_business',
      identityType: 'wa_id',
      identityValue: '14155550100',
      payload: expect.objectContaining({
        customerId,
        externalId: '+1 (415) 555-0100',
        text: 'hello',
      }),
    });
  });
});
