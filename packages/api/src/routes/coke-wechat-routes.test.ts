import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  membershipFindFirst: vi.fn(),
  resolveCokeAccountAccess: vi.fn(),
  ensureClawscaleUserForCokeAccount: vi.fn(),
  ensureClawscaleUserForCustomer: vi.fn(),
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
  verifyCokeToken: vi.fn(),
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

vi.mock('../lib/coke-account-access.js', () => ({
  resolveCokeAccountAccess: mocks.resolveCokeAccountAccess,
}));

vi.mock('../lib/clawscale-user.js', () => ({
  ensureClawscaleUserForCokeAccount: mocks.ensureClawscaleUserForCokeAccount,
  ensureClawscaleUserForCustomer: mocks.ensureClawscaleUserForCustomer,
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

vi.mock('../lib/coke-auth.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/coke-auth.js')>(
    '../lib/coke-auth.js',
  );

  return {
    ...actual,
    verifyCokeToken: mocks.verifyCokeToken,
  };
});

import { cokeWechatRouter } from './coke-wechat-routes.js';

function expectDeprecationHeaders(response: Response, successorPath: string) {
  expect(response.headers.get('Deprecation')).toBe('true');
  expect(response.headers.get('Link')).toBe(`<${successorPath}>; rel="successor-version"`);
}

function makeOwnerMembership(
  claimStatus: 'active' | 'pending' | 'unclaimed',
  customerId = 'ck_1',
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

describe('cokeWechatRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWeixinStatus.mockReturnValue(null);
    mocks.getWeixinQR.mockReturnValue(null);
    mocks.getWeixinRestoreState.mockReturnValue('ready');
  });

  it('rejects unauthorized requests', async () => {
    const app = new Hono();
    app.route('/api/coke/wechat-channel', cokeWechatRouter);

    const res = await app.request('/api/coke/wechat-channel', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expectDeprecationHeaders(res, '/api/customer/channels/wechat-personal');
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('blocks unverified customer-backed accounts before provisioning a personal channel', async () => {
    mocks.verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
    });
    mocks.membershipFindFirst.mockResolvedValue(makeOwnerMembership('pending'));
    mocks.resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: false,
      subscriptionActive: false,
      subscriptionExpiresAt: null,
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'email_not_verified',
      renewalUrl: 'https://coke.example/coke/renew',
    });

    const app = new Hono();
    app.route('/api/coke/wechat-channel', cokeWechatRouter);

    const res = await app.request('/api/coke/wechat-channel', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(403);
    expectDeprecationHeaders(res, '/api/customer/channels/wechat-personal');
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    expect(mocks.createOrReusePersonalWeChatChannel).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'email_not_verified',
    });
  });

  it('blocks suspended customer-backed accounts before provisioning a personal channel', async () => {
    mocks.verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
    });
    mocks.membershipFindFirst.mockResolvedValue(makeOwnerMembership('active'));
    mocks.resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'suspended',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'account_suspended',
      renewalUrl: 'https://coke.example/coke/renew',
    });

    const app = new Hono();
    app.route('/api/coke/wechat-channel', cokeWechatRouter);

    const res = await app.request('/api/coke/wechat-channel', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(403);
    expectDeprecationHeaders(res, '/api/customer/channels/wechat-personal');
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    expect(mocks.createOrReusePersonalWeChatChannel).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'account_suspended',
    });
  });

  it('blocks connect when the customer-backed account needs a subscription', async () => {
    mocks.verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
    });
    mocks.membershipFindFirst.mockResolvedValue(makeOwnerMembership('active'));
    mocks.resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: false,
      subscriptionExpiresAt: null,
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'subscription_required',
      renewalUrl: 'https://coke.example/coke/renew',
    });

    const app = new Hono();
    app.route('/api/coke/wechat-channel', cokeWechatRouter);

    const res = await app.request('/api/coke/wechat-channel/connect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(402);
    expectDeprecationHeaders(res, '/api/customer/channels/wechat-personal/connect');
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    expect(mocks.createOrReusePersonalWeChatChannel).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'subscription_required',
    });
  });

  it('connects an allowed customer-backed account using the neutral graph', async () => {
    mocks.verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
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
    app.route('/api/coke/wechat-channel', cokeWechatRouter);

    const res = await app.request('/api/coke/wechat-channel/connect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(200);
    expectDeprecationHeaders(res, '/api/customer/channels/wechat-personal/connect');
    expect(mocks.ensureClawscaleUserForCustomer).toHaveBeenCalledWith({
      customerId: 'ck_1',
    });
    expect(mocks.ensureClawscaleUserForCokeAccount).not.toHaveBeenCalled();
    expect(mocks.createOrReusePersonalWeChatChannel).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });
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

  it('returns account_not_found when there is no neutral owner membership', async () => {
    mocks.verifyCokeToken.mockReturnValue({
      sub: 'acct_missing',
      email: 'missing@example.com',
    });
    mocks.membershipFindFirst.mockResolvedValue(null);

    const app = new Hono();
    app.route('/api/coke/wechat-channel', cokeWechatRouter);

    const res = await app.request('/api/coke/wechat-channel/status', {
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(404);
    expectDeprecationHeaders(res, '/api/customer/channels/wechat-personal/status');
    expect(mocks.resolveCokeAccountAccess).not.toHaveBeenCalled();
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    expect(mocks.ensureClawscaleUserForCokeAccount).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'account_not_found',
    });
  });
});
