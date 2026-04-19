import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  verifyCokeToken: vi.fn(),
  getCustomerSession: vi.fn(),
  membershipFindFirst: vi.fn(),
  resolveCokeAccountAccess: vi.fn(),
  ensureClawscaleUserForCustomer: vi.fn(),
  ensureClawscaleUserForCokeAccount: vi.fn(),
  createOrReusePersonalWeChatChannel: vi.fn(),
  disconnectPersonalWeChatChannel: vi.fn(),
  archivePersonalWeChatChannel: vi.fn(),
  channelFindMany: vi.fn(),
  channelUpdate: vi.fn(),
  startWeixinQR: vi.fn(),
  getWeixinQR: vi.fn(),
  getWeixinStatus: vi.fn(),
  getWeixinRestoreState: vi.fn(),
  stopWeixinBot: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    membership: {
      findFirst: mocks.membershipFindFirst,
    },
    channel: {
      findMany: mocks.channelFindMany,
      update: mocks.channelUpdate,
    },
  },
}));

vi.mock('../lib/customer-auth.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/customer-auth.js')>(
    '../lib/customer-auth.js',
  );

  return {
    ...actual,
    getCustomerSession: mocks.getCustomerSession,
    verifyCustomerToken: mocks.verifyCustomerToken,
  };
});

vi.mock('../lib/coke-auth.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/coke-auth.js')>(
    '../lib/coke-auth.js',
  );

  return {
    ...actual,
    verifyCokeToken: mocks.verifyCokeToken,
  };
});

vi.mock('../lib/coke-account-access.js', () => ({
  resolveCokeAccountAccess: mocks.resolveCokeAccountAccess,
}));

vi.mock('../lib/clawscale-user.js', () => ({
  ensureClawscaleUserForCustomer: mocks.ensureClawscaleUserForCustomer,
  ensureClawscaleUserForCokeAccount: mocks.ensureClawscaleUserForCokeAccount,
}));

vi.mock('../lib/personal-wechat-channel.js', () => ({
  createOrReusePersonalWeChatChannel: mocks.createOrReusePersonalWeChatChannel,
  disconnectPersonalWeChatChannel: mocks.disconnectPersonalWeChatChannel,
  archivePersonalWeChatChannel: mocks.archivePersonalWeChatChannel,
}));

vi.mock('../adapters/wechat.js', () => ({
  startWeixinQR: mocks.startWeixinQR,
  getWeixinQR: mocks.getWeixinQR,
  getWeixinStatus: mocks.getWeixinStatus,
  getWeixinRestoreState: mocks.getWeixinRestoreState,
  stopWeixinBot: mocks.stopWeixinBot,
}));

import { customerChannelRouter } from './customer-channel-routes.js';

function makeOwnerMembership(
  claimStatus: 'active' | 'pending' | 'unclaimed',
  customerId = 'ck_customer_1',
) {
  return {
    role: 'owner',
    customer: {
      id: customerId,
      displayName: 'Alice',
    },
    identity: {
      id: 'idt_1',
      email: 'alice@example.com',
      claimStatus,
    },
  };
}

describe('customerChannelRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWeixinStatus.mockReturnValue(null);
    mocks.getWeixinQR.mockReturnValue(null);
    mocks.getWeixinRestoreState.mockReturnValue('ready');
    mocks.verifyCustomerToken.mockReturnValue({
      sub: 'ck_customer_1',
      identityId: 'idt_1',
      email: 'alice@example.com',
      tokenType: 'access',
    });
    mocks.verifyCokeToken.mockImplementation(() => {
      throw new Error('invalid_or_expired_token');
    });
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_customer_1',
      identityId: 'idt_1',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
    mocks.membershipFindFirst.mockResolvedValue(makeOwnerMembership('active'));
    mocks.resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://coke.example/coke/renew',
    });
    mocks.ensureClawscaleUserForCustomer.mockResolvedValue({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
      created: false,
      ready: true,
    });
  });

  it('returns channel status for the authenticated customer', async () => {
    mocks.channelFindMany.mockResolvedValue([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'disconnected',
        updatedAt: new Date('2026-04-16T00:00:00.000Z'),
      },
    ]);

    const app = new Hono();
    app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

    const res = await app.request('/api/customer/channels/wechat-personal/status', {
      headers: {
        authorization: 'Bearer customer-token',
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.ensureClawscaleUserForCustomer).toHaveBeenCalledWith({
      customerId: 'ck_customer_1',
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

  it('starts the QR flow for the authenticated customer', async () => {
    mocks.createOrReusePersonalWeChatChannel.mockResolvedValue({
      id: 'ch_1',
      status: 'disconnected',
    });
    mocks.getWeixinStatus.mockReturnValue('qr_pending');
    mocks.getWeixinQR.mockReturnValue({
      image: 'data:image/png;base64,abc',
      url: 'https://liteapp.weixin.qq.com/q/1',
    });

    const app = new Hono();
    app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

    const res = await app.request('/api/customer/channels/wechat-personal/connect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.channelUpdate).toHaveBeenCalledWith({
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

  it('disconnects the authenticated customer channel', async () => {
    mocks.disconnectPersonalWeChatChannel.mockResolvedValue({
      id: 'ch_1',
      status: 'disconnected',
    });

    const app = new Hono();
    app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

    const res = await app.request('/api/customer/channels/wechat-personal/disconnect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
      },
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

  it('archives the authenticated customer channel', async () => {
    mocks.channelFindMany.mockResolvedValue([
      {
        id: 'ch_1',
        type: 'wechat_personal',
        scope: 'personal',
        ownerClawscaleUserId: 'csu_1',
        status: 'disconnected',
        updatedAt: new Date('2026-04-16T00:00:00.000Z'),
      },
    ]);
    mocks.archivePersonalWeChatChannel.mockResolvedValue({
      id: 'ch_1',
      status: 'archived',
    });

    const app = new Hono();
    app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

    const res = await app.request('/api/customer/channels/wechat-personal', {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer customer-token',
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.archivePersonalWeChatChannel).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });
    expect(mocks.stopWeixinBot).toHaveBeenCalledWith('ch_1');
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

  it('blocks customer-token connect when the compatibility account is suspended', async () => {
    mocks.resolveCokeAccountAccess.mockResolvedValueOnce({
      accountStatus: 'suspended',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'account_suspended',
      renewalUrl: 'https://coke.example/coke/renew',
    });

    const app = new Hono();
    app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

    const res = await app.request('/api/customer/channels/wechat-personal/connect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
      },
    });

    expect(res.status).toBe(403);
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    expect(mocks.createOrReusePersonalWeChatChannel).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'account_suspended',
    });
  });

  it('returns account_not_found for a legacy-only coke token', async () => {
    mocks.verifyCustomerToken.mockImplementationOnce(() => {
      throw new Error('invalid_or_expired_token');
    });
    mocks.verifyCokeToken.mockReturnValueOnce({
      sub: 'acct_legacy_1',
      email: 'legacy@example.com',
    });
    mocks.membershipFindFirst.mockResolvedValueOnce(null);
    mocks.channelFindMany.mockResolvedValueOnce([]);

    const app = new Hono();
    app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

    const res = await app.request('/api/customer/channels/wechat-personal/status', {
      headers: {
        authorization: 'Bearer legacy-coke-token',
      },
    });

    expect(res.status).toBe(404);
    expect(mocks.resolveCokeAccountAccess).not.toHaveBeenCalled();
    expect(mocks.ensureClawscaleUserForCokeAccount).not.toHaveBeenCalled();
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'account_not_found',
    });
  });

  it('rejects customers whose claim status is not active', async () => {
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_customer_1',
      identityId: 'idt_1',
      claimStatus: 'pending',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });

    const app = new Hono();
    app.route('/api/customer/channels/wechat-personal', customerChannelRouter);

    const res = await app.request('/api/customer/channels/wechat-personal/status', {
      headers: {
        authorization: 'Bearer customer-token',
      },
    });

    expect(res.status).toBe(403);
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'claim_inactive',
    });
  });
});
