import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const tx = {
    externalIdentity: { upsert: vi.fn() },
  };

  const client = {
    externalIdentity: { findUnique: vi.fn() },
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
    db.externalIdentity.findUnique.mockResolvedValue({ customerId: 'ck_existing' });
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

    db.__tx.externalIdentity.upsert.mockImplementation(async (args: any) => ({
      customerId: args.create.customer.create.id,
    }));

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  it('routes an existing shared-channel customer on external identity lookup hit', async () => {
    db.__tx.externalIdentity.upsert.mockResolvedValueOnce({ customerId: 'ck_existing' });

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

    expect(db.__tx.externalIdentity.upsert).toHaveBeenCalledWith({
      where: {
        provider_identityType_identityValue: {
          provider: 'whatsapp_business',
          identityType: 'wa_id',
          identityValue: '14155550100',
        },
      },
      update: {
        lastSeenAt: expect.any(Date),
      },
      create: expect.objectContaining({
        provider: 'whatsapp_business',
        identityType: 'wa_id',
        identityValue: '14155550100',
        firstSeenChannelId: 'ch_1',
      }),
    });
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

    const upsertArgs = db.__tx.externalIdentity.upsert.mock.calls[0]?.[0];
    const customerId = upsertArgs?.create?.customer?.create?.id;

    expect(upsertArgs).toEqual({
      where: expect.objectContaining({
        provider_identityType_identityValue: {
          provider: 'whatsapp_business',
          identityType: 'wa_id',
          identityValue: '14155550100',
        },
      }),
      update: {
        lastSeenAt: expect.any(Date),
      },
      create: expect.objectContaining({
        provider: 'whatsapp_business',
        identityType: 'wa_id',
        identityValue: '14155550100',
        firstSeenChannelId: 'ch_1',
        customer: {
          create: expect.objectContaining({
            id: expect.stringMatching(/^ck_/),
            kind: 'personal',
            displayName: 'Alice',
            memberships: {
              create: expect.objectContaining({
                role: 'owner',
                identity: {
                  create: expect.objectContaining({
                    displayName: 'Alice',
                    claimStatus: 'unclaimed',
                  }),
                },
              }),
            },
            agentBindings: {
              create: expect.objectContaining({
                agentId: 'agent_shared',
                provisionStatus: 'pending',
              }),
            },
          }),
        },
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

    db.$transaction.mockImplementationOnce(async (fn: (txClient: typeof db.__tx) => Promise<unknown>) => {
      await expect(fn(db.__tx)).rejects.toEqual(uniqueConflict);
      throw uniqueConflict;
    });
    db.__tx.externalIdentity.upsert.mockRejectedValueOnce(uniqueConflict);
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

    expect(db.externalIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_identityType_identityValue: {
          provider: 'whatsapp_business',
          identityType: 'wa_id',
          identityValue: '14155550100',
        },
      },
      select: { customerId: true },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueParkedInbound).not.toHaveBeenCalled();
  });

  it('parks the concurrent loser until the winner finishes provisioning', async () => {
    const uniqueConflict = {
      code: 'P2002',
      meta: {
        target: ['provider', 'identityType', 'identityValue'],
      },
    };

    db.agentBinding.findUnique.mockResolvedValueOnce({
      customerId: 'ck_existing',
      provisionStatus: 'pending',
    });
    db.$transaction.mockImplementationOnce(async (fn: (txClient: typeof db.__tx) => Promise<unknown>) => {
      await expect(fn(db.__tx)).rejects.toEqual(uniqueConflict);
      throw uniqueConflict;
    });
    db.__tx.externalIdentity.upsert.mockRejectedValueOnce(uniqueConflict);
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
      parked: true,
      provisionStatus: 'pending',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueParkedInbound).toHaveBeenCalledWith({
      channelId: 'ch_1',
      provider: 'whatsapp_business',
      identityType: 'wa_id',
      identityValue: '14155550100',
      payload: expect.objectContaining({
        customerId: 'ck_existing',
        externalId: '+1 (415) 555-0100',
        text: 'hello',
      }),
    });
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

    const customerId = db.__tx.externalIdentity.upsert.mock.calls[0]?.[0]?.create?.customer?.create?.id;

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
