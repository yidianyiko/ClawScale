import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOrReusePersonalWeChatChannel: vi.fn(),
  disconnectPersonalWeChatChannel: vi.fn(),
  archivePersonalWeChatChannel: vi.fn(),
  ensureClawscaleUserForCokeAccount: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  startWeixinQR: vi.fn(),
  getWeixinQR: vi.fn(),
  getWeixinStatus: vi.fn(),
  getWeixinRestoreState: vi.fn(),
  stopWeixinBot: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    channel: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (c: any, next: any) => {
    c.set('auth', { userId: 'csu_1', tenantId: 'ten_1', role: 'user' });
    await next();
  },
}));

vi.mock('../lib/personal-wechat-channel.js', () => ({
  createOrReusePersonalWeChatChannel: mocks.createOrReusePersonalWeChatChannel,
  disconnectPersonalWeChatChannel: mocks.disconnectPersonalWeChatChannel,
  archivePersonalWeChatChannel: mocks.archivePersonalWeChatChannel,
}));

vi.mock('../lib/clawscale-user.js', () => ({
  ensureClawscaleUserForCokeAccount: mocks.ensureClawscaleUserForCokeAccount,
}));

vi.mock('../adapters/wechat.js', () => ({
  startWeixinQR: mocks.startWeixinQR,
  getWeixinQR: mocks.getWeixinQR,
  getWeixinStatus: mocks.getWeixinStatus,
  getWeixinRestoreState: mocks.getWeixinRestoreState,
  stopWeixinBot: mocks.stopWeixinBot,
}));

import { userWechatChannelRouter } from './user-wechat-channel.js';

describe('userWechatChannelRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWeixinStatus.mockReturnValue(null);
    mocks.getWeixinQR.mockReturnValue(null);
    mocks.getWeixinRestoreState.mockReturnValue('ready');
  });

  it('allows bridge api-key callers to resolve and create the account-owned channel', async () => {
    process.env.CLAWSCALE_IDENTITY_API_KEY = 'secret';
    mocks.ensureClawscaleUserForCokeAccount.mockResolvedValueOnce({
      tenantId: 'ten_bridge',
      clawscaleUserId: 'csu_bridge',
      created: false,
    });
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_bridge',
      status: 'disconnected',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ account_id: 'acct_1' }),
    });

    expect(res.status).toBe(200);
    expect(mocks.ensureClawscaleUserForCokeAccount).toHaveBeenCalledWith({
      cokeAccountId: 'acct_1',
    });
    expect(mocks.createOrReusePersonalWeChatChannel).toHaveBeenCalledWith({
      tenantId: 'ten_bridge',
      clawscaleUserId: 'csu_bridge',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_bridge',
        status: 'disconnected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('creates or reuses the authenticated user channel', async () => {
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'disconnected',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mocks.createOrReusePersonalWeChatChannel).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'disconnected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('starts the QR flow and returns pending with the live QR payload', async () => {
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'disconnected',
    });
    mocks.getWeixinStatus.mockReturnValue('qr_pending');
    mocks.getWeixinQR.mockReturnValue({
      image: 'data:image/png;base64,abc',
      url: 'https://liteapp.weixin.qq.com/q/1',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: { status: 'pending' },
    });
    expect(mocks.startWeixinQR).toHaveBeenCalledWith('ch_1');
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'pending',
        qr: 'data:image/png;base64,abc',
        qr_url: 'https://liteapp.weixin.qq.com/q/1',
        connect_url: 'https://liteapp.weixin.qq.com/q/1',
      },
    });
  });

  it('reports connected when the adapter has already confirmed the login', async () => {
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'connected',
    });
    mocks.getWeixinStatus.mockReturnValue('connected');

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mocks.startWeixinQR).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'connected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('restarts qr login instead of trusting a stale connected row when adapter state is absent', async () => {
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'connected',
    });
    mocks.getWeixinStatus.mockReturnValueOnce(null).mockReturnValue('qr_pending');
    mocks.getWeixinQR.mockReturnValue({
      image: 'data:image/png;base64,abc',
      url: 'https://liteapp.weixin.qq.com/q/1',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mocks.startWeixinQR).toHaveBeenCalledWith('ch_1');
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'pending',
        qr: 'data:image/png;base64,abc',
        qr_url: 'https://liteapp.weixin.qq.com/q/1',
        connect_url: 'https://liteapp.weixin.qq.com/q/1',
      },
    });
  });

  it('keeps a persisted connected row connected during startup when the adapter is not ready', async () => {
    mocks.getWeixinRestoreState.mockReturnValue('initializing');
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'connected',
    });
    mocks.getWeixinStatus.mockReturnValue(null);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.stopWeixinBot).not.toHaveBeenCalled();
    expect(mocks.startWeixinQR).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'connected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('returns disconnected for a persisted connected row after restore failure during connect', async () => {
    mocks.getWeixinRestoreState.mockReturnValue('failed');
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'connected',
    });
    mocks.getWeixinStatus.mockReturnValue(null);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'ch_1' },
      data: { status: 'pending' },
    });
    expect(mocks.startWeixinQR).toHaveBeenCalledWith('ch_1');
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'disconnected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('does not restart when the channel row is pending and the adapter is already qr_pending', async () => {
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'pending',
    });
    mocks.getWeixinStatus.mockReturnValue('qr_pending');
    mocks.getWeixinQR.mockReturnValue({
      image: 'data:image/png;base64,abc',
      url: 'https://liteapp.weixin.qq.com/q/1',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/connect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.stopWeixinBot).not.toHaveBeenCalled();
    expect(mocks.startWeixinQR).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'pending',
        qr: 'data:image/png;base64,abc',
        qr_url: 'https://liteapp.weixin.qq.com/q/1',
        connect_url: 'https://liteapp.weixin.qq.com/q/1',
      },
    });
  });

  it('consults restore-state initializing and waits for delayed qr availability before resolving connect', async () => {
    vi.useFakeTimers();
    try {
      mocks.getWeixinRestoreState.mockReturnValue('initializing');
      mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
        id: 'ch_1',
        status: 'disconnected',
      });
      mocks.getWeixinStatus
        .mockReturnValueOnce('qr_pending')
        .mockReturnValue('qr_pending');
      mocks.getWeixinQR.mockReturnValueOnce(null).mockReturnValue({
        image: 'data:image/png;base64,abc',
        url: 'https://liteapp.weixin.qq.com/q/1',
      });

      const app = new Hono();
      app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

      const resPromise = app.request('/api/internal/user/wechat-channel/connect', {
        method: 'POST',
      });

      await vi.advanceTimersByTimeAsync(250);
      const res = await resPromise;

      expect(res.status).toBe(200);
      expect(mocks.getWeixinRestoreState).toHaveBeenCalled();
      await expect(res.json()).resolves.toEqual({
        ok: true,
        data: {
          channel_id: 'ch_1',
          status: 'pending',
          qr: 'data:image/png;base64,abc',
          qr_url: 'https://liteapp.weixin.qq.com/q/1',
          connect_url: 'https://liteapp.weixin.qq.com/q/1',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves connect to error when qr_pending turns into error while waiting', async () => {
    vi.useFakeTimers();
    try {
      mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
        id: 'ch_1',
        status: 'pending',
      });
      mocks.getWeixinStatus
        .mockReturnValueOnce('qr_pending')
        .mockReturnValue('error');
      mocks.getWeixinQR.mockReturnValue(null);

      const app = new Hono();
      app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

      const resPromise = app.request('/api/internal/user/wechat-channel/connect', {
        method: 'POST',
      });

      await vi.advanceTimersByTimeAsync(250);
      const res = await resPromise;

      expect(res.status).toBe(200);
      expect(mocks.startWeixinQR).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toEqual({
        ok: true,
        data: {
          channel_id: 'ch_1',
          status: 'error',
          qr: null,
          qr_url: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves connect to connected when qr_pending turns into connected while waiting', async () => {
    vi.useFakeTimers();
    try {
      mocks.createOrReusePersonalWeChatChannel.mockResolvedValueOnce({
        id: 'ch_1',
        status: 'pending',
      });
      mocks.getWeixinStatus
        .mockReturnValueOnce('qr_pending')
        .mockReturnValue('connected');
      mocks.getWeixinQR.mockReturnValue(null);

      const app = new Hono();
      app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

      const resPromise = app.request('/api/internal/user/wechat-channel/connect', {
        method: 'POST',
      });

      await vi.advanceTimersByTimeAsync(250);
      const res = await resPromise;

      expect(res.status).toBe(200);
      expect(mocks.startWeixinQR).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toEqual({
        ok: true,
        data: {
          channel_id: 'ch_1',
          status: 'connected',
          qr: null,
          qr_url: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns missing when the user has no personal channel yet', async () => {
    mocks.findMany.mockResolvedValueOnce([]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/status');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: null,
        status: 'missing',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('returns archived for the latest archived channel row', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'archived',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/status');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'archived',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('returns a structured conflict when duplicate active rows make status ambiguous', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'disconnected',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
      {
        id: 'ch_2',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'error',
        updatedAt: new Date('2026-04-07T00:00:01.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/status');

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_personal_channel_rows',
    });
  });

  it('rejects deleting a persisted connected row while the adapter is not ready', async () => {
    mocks.getWeixinRestoreState.mockReturnValue('initializing');
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    expect(mocks.stopWeixinBot).not.toHaveBeenCalled();
    expect(mocks.archivePersonalWeChatChannel).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'disconnect_before_archive',
    });
  });

  it('maps a stale connected row without adapter state to disconnected', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/status');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'disconnected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('treats a persisted connected row as disconnected after restore failure in status', async () => {
    mocks.getWeixinRestoreState.mockReturnValue('failed');
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/status');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'disconnected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('maps a stale pending row without adapter state to error', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'pending',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/status');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'error',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('disconnects the live WeChat bot before reporting disconnected', async () => {
    mocks.disconnectPersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'disconnected',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel/disconnect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mocks.disconnectPersonalWeChatChannel).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });
    expect(mocks.stopWeixinBot).toHaveBeenCalledWith('ch_1');
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'disconnected',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('archives a disconnected personal channel', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'disconnected',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);
    mocks.archivePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'archived',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(mocks.stopWeixinBot).toHaveBeenCalledWith('ch_1');
    expect(mocks.archivePersonalWeChatChannel).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'archived',
        qr: null,
        qr_url: null,
      },
    });
  });

  it('returns a structured conflict when delete sees duplicate active rows', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'disconnected',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
      {
        id: 'ch_2',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'error',
        updatedAt: new Date('2026-04-07T00:00:01.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    expect(mocks.stopWeixinBot).not.toHaveBeenCalled();
    expect(mocks.archivePersonalWeChatChannel).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'duplicate_personal_channel_rows',
    });
  });

  it('rejects archiving a pending channel before stop or archive', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'pending',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);
    mocks.getWeixinStatus.mockReturnValue('qr_pending');

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    expect(mocks.stopWeixinBot).not.toHaveBeenCalled();
    expect(mocks.archivePersonalWeChatChannel).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'disconnect_before_archive',
    });
  });

  it('allows deleting a persisted connected row after restore failure', async () => {
    mocks.getWeixinRestoreState.mockReturnValue('failed');
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'connected',
        updatedAt: new Date('2026-04-07T00:00:00.000Z'),
      },
    ]);
    mocks.archivePersonalWeChatChannel.mockResolvedValueOnce({
      id: 'ch_1',
      status: 'archived',
    });

    const app = new Hono();
    app.route('/api/internal/user/wechat-channel', userWechatChannelRouter);

    const res = await app.request('/api/internal/user/wechat-channel', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(mocks.stopWeixinBot).toHaveBeenCalledWith('ch_1');
    expect(mocks.archivePersonalWeChatChannel).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        channel_id: 'ch_1',
        status: 'archived',
        qr: null,
        qr_url: null,
      },
    });
  });
});
