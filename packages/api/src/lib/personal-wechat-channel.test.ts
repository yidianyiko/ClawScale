import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  channel: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  clawscaleUser: {
    findUnique: vi.fn(),
  },
}));

const generateId = vi.hoisted(() => vi.fn(() => 'ch_new'));
const wechat = vi.hoisted(() => ({
  getWeixinRestoreState: vi.fn(),
  getWeixinStatus: vi.fn(),
}));

vi.mock('../db/index.js', () => ({ db }));
vi.mock('./id.js', () => ({ generateId }));
vi.mock('../adapters/wechat.js', () => wechat);

import {
  archivePersonalWeChatChannel,
  createOrReusePersonalWeChatChannel,
  disconnectPersonalWeChatChannel,
} from './personal-wechat-channel.js';

describe('createOrReusePersonalWeChatChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
      cokeAccountId: 'acc_1',
    });
  });

  it('creates a personal wechat_personal channel when none exists', async () => {
    db.channel.findMany.mockResolvedValueOnce([]);
    db.channel.create.mockResolvedValueOnce({
      id: 'ch_1',
      tenantId: 'ten_1',
      type: 'wechat_personal',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      activeLifecycleKey: 'ten_1:csu_1:wechat_personal',
      status: 'disconnected',
    });

    const result = await createOrReusePersonalWeChatChannel({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });

    expect(db.channel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'ch_new',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        activeLifecycleKey: 'ten_1:csu_1:wechat_personal',
        status: 'disconnected',
      }),
    });
    expect(result.status).toBe('disconnected');
  });

  it('reuses an existing non-archived personal channel', async () => {
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_existing',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'error',
      },
    ]);

    const result = await createOrReusePersonalWeChatChannel({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });

    expect(db.channel.create).not.toHaveBeenCalled();
    expect(result.id).toBe('ch_existing');
    expect(result.status).toBe('error');
  });

  it('retries only on activeLifecycleKey unique conflicts', async () => {
    db.channel.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'ch_winner',
          tenantId: 'ten_1',
          type: 'wechat_personal',
          scope: 'personal',
          ownerClawscaleUserId: 'csu_1',
          status: 'disconnected',
        },
      ]);
    db.channel.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['activeLifecycleKey'] },
    });

    const result = await createOrReusePersonalWeChatChannel({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });

    expect(db.channel.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('ch_winner');
    expect(result.status).toBe('disconnected');
  });

  it('does not retry unique conflicts on other fields', async () => {
    db.channel.findMany.mockResolvedValueOnce([]);
    db.channel.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['tenantId'] },
    });

    await expect(
      createOrReusePersonalWeChatChannel({
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: ['tenantId'] },
    });

    expect(db.channel.create).toHaveBeenCalledTimes(1);
    expect(db.channel.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate active personal rows instead of picking one arbitrarily', async () => {
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_a',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'error',
      },
      {
        id: 'ch_b',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'disconnected',
      },
    ]);

    await expect(
      createOrReusePersonalWeChatChannel({
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
      }),
    ).rejects.toThrow('duplicate_personal_channel_rows');

    expect(db.channel.create).not.toHaveBeenCalled();
  });
});

describe('disconnectPersonalWeChatChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
      cokeAccountId: 'acc_1',
    });
  });

  it('moves a connected personal channel to disconnected', async () => {
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
        config: { token: 'bot-token' },
      },
    ]);
    db.channel.update.mockResolvedValueOnce({ id: 'ch_1', status: 'disconnected' });

    const result = await disconnectPersonalWeChatChannel({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });

    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: expect.objectContaining({
        status: 'disconnected',
        config: {},
      }),
    });
    expect(result.status).toBe('disconnected');
  });

  it('rejects an invalid fetched row before updating', async () => {
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'tenant_shared',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
      },
    ]);

    await expect(
      disconnectPersonalWeChatChannel({
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
      }),
    ).rejects.toThrow('invalid_personal_channel_row');

    expect(db.channel.update).not.toHaveBeenCalled();
  });
});

describe('archivePersonalWeChatChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.clawscaleUser.findUnique.mockResolvedValue({
      id: 'csu_1',
      tenantId: 'ten_1',
      cokeAccountId: 'acc_1',
    });
    wechat.getWeixinRestoreState.mockReturnValue('ready');
    wechat.getWeixinStatus.mockReturnValue(null);
  });

  it('archives a disconnected personal channel so a fresh one can later be created', async () => {
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'disconnected',
      },
    ]);
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'archived',
      activeLifecycleKey: null,
    });

    const result = await archivePersonalWeChatChannel({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });

    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: expect.objectContaining({
        status: 'archived',
        config: {},
        activeLifecycleKey: null,
      }),
    });
    expect(result.status).toBe('archived');
  });

  it('rejects archiving when the adapter is still connected', async () => {
    wechat.getWeixinStatus.mockReturnValue('connected');
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
      },
    ]);

    await expect(
      archivePersonalWeChatChannel({
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
      }),
    ).rejects.toThrow('disconnect_before_archive');
  });

  it('archives a persisted connected row after restore failure when the adapter is already degraded', async () => {
    wechat.getWeixinRestoreState.mockReturnValue('failed');
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
      },
    ]);
    db.channel.update.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'archived',
      activeLifecycleKey: null,
    });

    const result = await archivePersonalWeChatChannel({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });

    expect(result.status).toBe('archived');
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: expect.objectContaining({
        status: 'archived',
        config: {},
        activeLifecycleKey: null,
      }),
    });
  });

  it('rejects an invalid fetched row before archiving', async () => {
    db.channel.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        tenantId: 'ten_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: null,
        status: 'disconnected',
      },
    ]);

    await expect(
      archivePersonalWeChatChannel({
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
      }),
    ).rejects.toThrow('invalid_personal_channel_row');

    expect(db.channel.update).not.toHaveBeenCalled();
  });
});
