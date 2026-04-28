import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  channel: { findUnique: vi.fn() },
  tenant: { findUnique: vi.fn() },
  membership: { findFirst: vi.fn() },
  endUser: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  conversation: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  deliveryRoute: { findFirst: vi.fn() },
  message: { create: vi.fn(), findMany: vi.fn() },
  cokeAccount: { findUnique: vi.fn() },
  aiBackend: { findMany: vi.fn() },
  endUserBackend: { upsert: vi.fn(), deleteMany: vi.fn() },
}));

const generateReply = vi.hoisted(() => vi.fn());
const getUnifiedConversationIds = vi.hoisted(() => vi.fn());
const bindEndUserToCokeAccount = vi.hoisted(() => vi.fn());
const bindBusinessConversation = vi.hoisted(() => vi.fn());
const upsertDirectDeliveryRoute = vi.hoisted(() => vi.fn());
const resolveCokeAccountAccess = vi.hoisted(() => vi.fn());
const issuePublicCheckoutToken = vi.hoisted(() => vi.fn());
const buildPublicCheckoutUrl = vi.hoisted(() => vi.fn());
const provisionSharedChannelCustomer = vi.hoisted(() => vi.fn());
const createRouteBindingSnapshot = vi.hoisted(() => vi.fn());

vi.mock('../db/index.js', () => ({ db }));
vi.mock('./ai-backend.js', () => ({ generateReply }));
vi.mock('./clawscale-user.js', () => ({ getUnifiedConversationIds, bindEndUserToCokeAccount }));
vi.mock('./business-conversation.js', () => ({
  bindBusinessConversation,
  upsertDirectDeliveryRoute,
}));
vi.mock('./coke-account-access.js', () => ({ resolveCokeAccountAccess }));
vi.mock('./coke-public-checkout.js', () => ({
  issuePublicCheckoutToken,
  buildPublicCheckoutUrl,
}));
vi.mock('./shared-channel-provisioning.js', () => ({ provisionSharedChannelCustomer }));
vi.mock('./route-binding.js', async () => {
  const actual = await vi.importActual<typeof import('./route-binding.js')>('./route-binding.js');
  createRouteBindingSnapshot.mockImplementation(actual.createRouteBindingSnapshot);
  return {
    ...actual,
    createRouteBindingSnapshot,
  };
});
vi.mock('./clawscale-agent.js', () => ({
  buildSelectionMenu: vi.fn(() => 'menu'),
  runClawscaleAgent: vi.fn(),
}));

import { routeInboundMessage } from './route-message.js';

describe('routeInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      type: 'whatsapp_business',
      customerId: null,
      ownershipKind: 'shared',
      agentId: 'agent_shared',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });
    db.tenant.findUnique.mockResolvedValue({
      id: 'ten_1',
      settings: {},
    });
    db.endUser.findUnique.mockResolvedValue(null);
    db.endUser.create.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [],
    });
    db.endUser.findMany.mockResolvedValue([{ id: 'eu_1' }, { id: 'eu_2' }]);
    db.conversation.findFirst.mockResolvedValue(null);
    db.conversation.create.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      clawscaleUserId: null,
      businessConversationKey: null,
    });
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_1' }, { id: 'conv_2' }]);
    db.deliveryRoute.findFirst.mockResolvedValue(null);
    db.message.create.mockResolvedValue({});
    db.message.findMany.mockResolvedValue([]);
    db.membership.findFirst.mockResolvedValue({
      customer: { id: 'ck_customer_1', displayName: 'Alice' },
      identity: { claimStatus: 'active' },
    });
    db.aiBackend.findMany.mockResolvedValue([
      {
        id: 'ab_1',
        tenantId: 'ten_1',
        name: 'Coke Bridge',
        type: 'custom',
        config: {
          baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
          responseFormat: 'json-auto',
        },
        isActive: true,
        isDefault: true,
      },
    ]);
    db.endUserBackend.upsert.mockResolvedValue({});
    db.endUserBackend.deleteMany.mockResolvedValue({});
    db.conversation.update.mockResolvedValue({});
    generateReply.mockResolvedValue('bridge ok');
    bindBusinessConversation.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'wxid_123',
      isActive: true,
    });
    upsertDirectDeliveryRoute.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_conv_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'wxid_123',
      isActive: true,
    });
    bindEndUserToCokeAccount.mockResolvedValue({
      clawscaleUserId: 'csu_1',
      endUserId: 'eu_1',
      cokeAccountId: 'acct_1',
    });
    resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: null,
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://coke.example/account/subscription',
    });
    issuePublicCheckoutToken.mockReturnValue('signed-public-token');
    buildPublicCheckoutUrl.mockReturnValue(
      'https://coke.example/api/public/subscription-checkout?token=signed-public-token',
    );
    getUnifiedConversationIds.mockResolvedValue(['conv_1', 'conv_2']);
    provisionSharedChannelCustomer.mockResolvedValue({
      customerId: 'ck_shared_1',
      created: false,
      parked: false,
      provisionStatus: 'ready',
    });
  });

  it('derives shared-channel provider from channel type when meta.platform is missing', async () => {
    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: '+1 (415) 555-0100',
      displayName: 'Alice',
      text: 'hello',
      meta: {},
    });

    expect(provisionSharedChannelCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch_1',
        agentId: 'agent_shared',
        provider: 'whatsapp_business',
        identityType: 'wa_id',
        rawIdentityValue: '+1 (415) 555-0100',
      }),
    );
  });

  it('ignores mismatched meta.platform when provisioning whatsapp_evolution shared channels', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      type: 'whatsapp_evolution',
      customerId: null,
      ownershipKind: 'shared',
      agentId: 'agent_shared',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: '8619917902815@s.whatsapp.net',
      displayName: 'Alice',
      text: 'hello',
      meta: { platform: 'telegram' },
    });

    expect(provisionSharedChannelCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch_1',
        agentId: 'agent_shared',
        provider: 'whatsapp_evolution',
        identityType: 'wa_id',
        rawIdentityValue: '8619917902815@s.whatsapp.net',
      }),
    );
  });

  it('parks shared-channel inbound before legacy end-user routing when provisioning is not ready', async () => {
    provisionSharedChannelCustomer.mockResolvedValueOnce({
      customerId: 'ck_shared_1',
      created: true,
      parked: true,
      provisionStatus: 'pending',
    });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: '+1 (415) 555-0100',
      displayName: 'Alice',
      text: 'hello',
      meta: { platform: 'whatsapp_business' },
    });

    expect(result).toBeNull();
    expect(provisionSharedChannelCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch_1',
        agentId: 'agent_shared',
        provider: 'whatsapp_business',
        identityType: 'wa_id',
        rawIdentityValue: '+1 (415) 555-0100',
      }),
    );
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
    expect(db.endUser.findUnique).not.toHaveBeenCalled();
  });

  it('threads the provisioned shared-channel customerId into downstream routing metadata', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello shared channel',
      meta: { platform: 'whatsapp_business' },
    });

    expect(createRouteBindingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'ck_shared_1',
      }),
    );
    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        customerId: 'ck_shared_1',
        customer_id: 'ck_shared_1',
      }),
    );
    expect(db.message.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            customerId: 'ck_shared_1',
            customer_id: 'ck_shared_1',
          }),
        }),
      }),
    );
  });

  it('resolves shared WhatsApp access against the provisioned customer owner without email gating', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello shared channel',
      meta: { platform: 'whatsapp_business' },
    });

    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_shared_1',
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            id: true,
            displayName: true,
          },
        },
        identity: {
          select: {
            claimStatus: true,
          },
        },
      },
    });
    expect(resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'ck_shared_1',
        displayName: 'Alice',
        emailVerified: true,
        status: 'normal',
      },
      requireEmailVerified: false,
    });
    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        customerId: 'ck_shared_1',
        customer_id: 'ck_shared_1',
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: true,
        subscriptionExpiresAt: null,
        accountAccessAllowed: true,
        accountAccessDeniedReason: null,
        renewalUrl: 'https://coke.example/account/subscription',
      }),
    );
    expect(issuePublicCheckoutToken).not.toHaveBeenCalled();
    expect(buildPublicCheckoutUrl).not.toHaveBeenCalled();
  });

  it('resolves shared WeChat Ecloud access against the provisioned customer owner without email gating', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      type: 'wechat_ecloud',
      customerId: null,
      ownershipKind: 'shared',
      agentId: 'agent_shared',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_target',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.membership.findFirst.mockResolvedValueOnce({
      customer: { id: 'ck_shared_1', displayName: 'Alice' },
      identity: { claimStatus: 'unclaimed' },
    });
    resolveCokeAccountAccess.mockResolvedValueOnce({
      accountStatus: 'normal',
      emailVerified: false,
      subscriptionActive: true,
      subscriptionExpiresAt: null,
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://coke.example/account/subscription',
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_target',
      displayName: 'Alice',
      text: 'hello shared ecloud',
      meta: { platform: 'wechat_ecloud' },
    });

    expect(provisionSharedChannelCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch_1',
        agentId: 'agent_shared',
        provider: 'wechat_ecloud',
        identityType: 'external_id',
        rawIdentityValue: 'wxid_target',
      }),
    );
    expect(resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'ck_shared_1',
        displayName: 'Alice',
        emailVerified: false,
        status: 'normal',
      },
      requireEmailVerified: false,
    });
    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        customerId: 'ck_shared_1',
        customer_id: 'ck_shared_1',
        emailVerified: false,
        accountAccessAllowed: true,
      }),
    );
  });

  it('provisions linq shared channels with phone_number identity and shared access semantics', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_linq',
      tenantId: 'ten_1',
      type: 'linq',
      customerId: null,
      ownershipKind: 'shared',
      agentId: 'agent_shared',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_linq',
      externalId: '+86 152 017 80593',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });

    await routeInboundMessage({
      channelId: 'ch_linq',
      externalId: '+86 152 017 80593',
      displayName: 'Alice',
      text: 'hello from linq',
      meta: { platform: 'linq' },
    });

    expect(provisionSharedChannelCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch_linq',
        agentId: 'agent_shared',
        provider: 'linq',
        identityType: 'phone_number',
        rawIdentityValue: '+86 152 017 80593',
      }),
    );
    expect(resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'ck_shared_1',
        displayName: 'Alice',
        emailVerified: true,
        status: 'normal',
      },
      requireEmailVerified: false,
    });
  });

  it('injects a signed public renewal link for shared subscription_required access', async () => {
    resolveCokeAccountAccess.mockResolvedValueOnce({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: false,
      subscriptionExpiresAt: '2026-04-01T00:00:00.000Z',
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'subscription_required',
      renewalUrl: 'https://coke.example/account/subscription',
    });
    issuePublicCheckoutToken.mockReturnValueOnce('signed-public-token');
    buildPublicCheckoutUrl.mockReturnValueOnce(
      'https://coke.example/api/public/subscription-checkout?token=signed-public-token',
    );

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello renewal',
      meta: { platform: 'whatsapp_business' },
    });

    expect(issuePublicCheckoutToken).toHaveBeenCalledWith({
      customerId: 'ck_shared_1',
    });
    expect(buildPublicCheckoutUrl).toHaveBeenCalledWith('signed-public-token');
    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        accountAccessDeniedReason: 'subscription_required',
        renewalUrl: 'https://coke.example/api/public/subscription-checkout?token=signed-public-token',
      }),
    );
  });

  it('binds the first shared WhatsApp business route against the provisioned customer account', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello shared channel',
      meta: { platform: 'whatsapp_business' },
    });

    expect(bindEndUserToCokeAccount).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      cokeAccountId: 'ck_shared_1',
    });
    expect(bindBusinessConversation).toHaveBeenCalledWith({
      routeBinding: expect.objectContaining({
        cokeAccountId: 'ck_shared_1',
        customerId: 'ck_shared_1',
      }),
      businessConversationKey: 'biz_conv_1',
    });
  });

  it('falls back to a direct delivery route when shared first-turn tenant binding is incompatible', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
    });
    bindEndUserToCokeAccount.mockRejectedValueOnce({
      code: 'coke_account_tenant_mismatch',
      message: 'Coke account belongs to a different tenant',
    });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello shared channel',
      meta: { platform: 'whatsapp_business' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
    expect(bindBusinessConversation).not.toHaveBeenCalled();
    expect(upsertDirectDeliveryRoute).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'wxid_123',
      cokeAccountId: 'ck_shared_1',
      gatewayConversationId: 'conv_1',
      businessConversationKey: 'biz_conv_1',
    });
    expect(db.message.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          backendId: 'ab_1',
          content: 'bridge ok',
          metadata: expect.not.objectContaining({
            businessConversationBindingErrorCode: 'coke_account_tenant_mismatch',
          }),
        }),
      }),
    );
  });

  it('keeps non-WhatsApp shared channels on the legacy account access path', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      type: 'wechat_personal',
      customerId: null,
      ownershipKind: 'shared',
      agentId: 'agent_shared',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: 'csu_legacy_1',
      clawscaleUser: { id: 'csu_legacy_1', cokeAccountId: 'ck_legacy_1' },
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.membership.findFirst.mockResolvedValueOnce({
      customer: { id: 'ck_legacy_1', displayName: 'Legacy Alice' },
      identity: { claimStatus: 'active' },
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello shared wechat',
      meta: { platform: 'wechat_personal' },
    });

    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_legacy_1',
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            id: true,
            displayName: true,
          },
        },
        identity: {
          select: {
            claimStatus: true,
          },
        },
      },
    });
    expect(resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'ck_legacy_1',
        displayName: 'Legacy Alice',
        emailVerified: true,
        status: 'normal',
      },
    });
    expect(issuePublicCheckoutToken).not.toHaveBeenCalled();
    expect(buildPublicCheckoutUrl).not.toHaveBeenCalled();
  });

  it('binds first-turn business conversation key returned by backend', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      customerId: null,
      ownershipKind: 'customer',
      agentId: null,
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
      causalInboundEventId: 'in_evt_prev',
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'first message',
      meta: { platform: 'wechat_personal' },
    });

    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        gatewayConversationId: 'conv_1',
        inboundEventId: expect.any(String),
      }),
    );
    expect(firstGenerateCall?.metadata?.businessConversationKey).toBeUndefined();

    expect(bindBusinessConversation).toHaveBeenCalledWith({
      routeBinding: expect.objectContaining({
        tenantId: 'ten_1',
        channelId: 'ch_1',
        endUserId: 'eu_1',
        externalEndUserId: 'wxid_123',
        cokeAccountId: 'acct_1',
        customerId: null,
        gatewayConversationId: 'conv_1',
        businessConversationKey: null,
        previousBusinessConversationKey: null,
        previousClawscaleUserId: null,
      }),
      businessConversationKey: 'biz_conv_1',
    });
    expect(bindEndUserToCokeAccount).toHaveBeenCalledWith({
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      cokeAccountId: 'acct_1',
    });
    const preBindOrder = vi.mocked(bindEndUserToCokeAccount).mock.invocationCallOrder[0];
    const bindOrder = vi.mocked(bindBusinessConversation).mock.invocationCallOrder[0];
    expect(preBindOrder).toBeDefined();
    expect(bindOrder).toBeDefined();
    if (preBindOrder === undefined || bindOrder === undefined) {
      throw new Error('expected both binding calls to have invocation order entries');
    }
    expect(preBindOrder).toBeLessThan(bindOrder);
    expect(db.message.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv_1',
          role: 'user',
          content: 'first message',
          metadata: expect.objectContaining({
            platform: 'wechat_personal',
            channelScope: 'personal',
            clawscaleUserId: 'csu_1',
            cokeAccountId: 'acct_1',
            inboundEventId: expect.any(String),
          }),
        }),
      }),
    );
    expect(db.message.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv_1',
          role: 'assistant',
          content: 'bridge ok',
          backendId: 'ab_1',
          metadata: expect.objectContaining({
            backendName: 'Coke Bridge',
            businessConversationKey: 'biz_conv_1',
            outputId: 'out_1',
            causalInboundEventId: 'in_evt_prev',
          }),
        }),
      }),
    );
  });

  it('prefers delivery-route businessConversationKey over legacy conversation metadata', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.conversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      clawscaleUserId: 'csu_legacy',
      businessConversationKey: 'biz_legacy',
    });
    db.deliveryRoute.findFirst.mockResolvedValue({
      tenantId: 'ten_1',
      cokeAccountId: 'acct_1',
      businessConversationKey: 'biz_route',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalEndUserId: 'wxid_123',
      isActive: true,
    });
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      customerId: 'cust_1',
      ownershipKind: 'customer',
      agentId: null,
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'followup',
      meta: { platform: 'wechat_personal' },
    });

    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        businessConversationKey: 'biz_route',
        gatewayConversationId: 'conv_1',
        customerId: 'cust_1',
        customer_id: 'cust_1',
        cokeAccountId: 'acct_1',
        coke_account_id: 'acct_1',
      }),
    );
    expect(bindBusinessConversation).not.toHaveBeenCalled();
    expect(db.message.create).toHaveBeenCalledTimes(2);
  });

  it('keeps backend reply when post-reply business binding fails', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      customerId: null,
      ownershipKind: 'customer',
      agentId: null,
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({
      text: 'bridge ok',
      businessConversationKey: 'biz_conv_1',
      outputId: 'out_1',
    });
    bindBusinessConversation.mockRejectedValueOnce({
      code: 'conversation_binding_conflict',
      message: 'race',
    });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello',
      meta: { platform: 'wechat_personal' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
    expect(db.message.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          backendId: 'ab_1',
          content: 'bridge ok',
          metadata: expect.objectContaining({
            businessConversationKey: 'biz_conv_1',
            outputId: 'out_1',
            businessConversationBindingErrorCode: 'conversation_binding_conflict',
            businessConversationBindingErrorMessage: 'business conversation bind failed',
          }),
        }),
      }),
    );
  });

  it('uses personal channel ownership metadata before legacy lookup', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      customerId: null,
      ownershipKind: 'customer',
      agentId: null,
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.message.findMany.mockResolvedValue([{ role: 'user', content: 'historical' }]);
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_1' }, { id: 'conv_2' }]);
    getUnifiedConversationIds.mockResolvedValueOnce(['conv_1', 'conv_2']);

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(getUnifiedConversationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'ten_1',
        endUserId: 'eu_1',
        clawscaleUserId: 'csu_1',
        linkedTo: null,
      }),
    );
    expect(generateReply).toHaveBeenCalledOnce();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tenantId: 'ten_1',
          channelId: 'ch_1',
          endUserId: 'eu_1',
          conversationId: 'conv_1',
          externalId: 'wxid_123',
          clawscaleUserId: 'csu_1',
          cokeAccountId: 'acct_1',
          coke_account_id: 'acct_1',
          channelScope: 'personal',
        }),
      }),
    );
    expect(db.message.create).toHaveBeenCalledTimes(2);
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_1', 'conv_2'] },
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
  });

  it('forwards Coke account access metadata to bridge backends on personal channels', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      customerId: 'ck_customer_1',
      ownershipKind: 'customer',
      agentId: null,
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'ck_customer_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'hello bridge',
      meta: { platform: 'wechat_personal' },
    });

    const firstGenerateCall = vi.mocked(generateReply).mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'ck_customer_1',
        displayName: 'Alice',
        emailVerified: true,
        status: 'normal',
      },
    });
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_customer_1',
        role: 'owner',
      },
      include: {
        customer: {
          select: {
            id: true,
            displayName: true,
          },
        },
        identity: {
          select: {
            claimStatus: true,
          },
        },
      },
    });
    expect(db.cokeAccount.findUnique).not.toHaveBeenCalled();
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        customerId: 'ck_customer_1',
        customer_id: 'ck_customer_1',
        cokeAccountId: 'ck_customer_1',
        coke_account_id: 'ck_customer_1',
        cokeAccountDisplayName: 'Alice',
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: true,
        subscriptionExpiresAt: null,
        accountAccessAllowed: true,
        accountAccessDeniedReason: null,
        renewalUrl: 'https://coke.example/account/subscription',
      }),
    );
    expect(firstGenerateCall?.metadata).toEqual(
      expect.objectContaining({
        gatewayConversationId: 'conv_1',
        inboundEventId: expect.any(String),
        channelScope: 'personal',
      }),
    );
  });

  it('persists message rows so subsequent turns can load history continuity', async () => {
    const persistedMessages: Array<{
      role: 'user' | 'assistant';
      content: string;
      backendId?: string | null;
      metadata?: Record<string, unknown>;
    }> = [];

    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.conversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      clawscaleUserId: null,
      businessConversationKey: null,
    });
    db.message.create.mockImplementation(async ({ data }) => {
      persistedMessages.push({
        role: data.role,
        content: data.content,
        backendId: data.backendId ?? null,
        metadata: (data.metadata ?? {}) as Record<string, unknown>,
      });
      return {};
    });
    db.message.findMany.mockImplementation(async ({ where }) => {
      const backendId =
        where?.OR?.find((entry: Record<string, unknown>) => 'backendId' in entry)?.backendId ?? null;

      return persistedMessages
        .filter((message) => {
          if (message.role === 'user') return true;
          return message.role === 'assistant' && message.backendId === backendId;
        })
        .map((message) => ({
          role: message.role,
          content: message.content,
          metadata: message.metadata ?? {},
        }));
    });
    generateReply
      .mockResolvedValueOnce('bridge first')
      .mockResolvedValueOnce('bridge second');

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'first turn',
      meta: { platform: 'wechat_personal' },
    });

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: 'second turn',
      meta: { platform: 'wechat_personal' },
    });

    const secondGenerateCall = vi.mocked(generateReply).mock.calls[1]?.[0] as
      | { history?: Array<{ role: 'user' | 'assistant'; content: string }> }
      | undefined;

    expect(secondGenerateCall?.history).toEqual([
      { role: 'user', content: 'first turn' },
      { role: 'assistant', content: 'bridge first' },
      { role: 'user', content: 'second turn' },
    ]);
    expect(db.message.create).toHaveBeenCalledTimes(4);
  });

  it('falls back to current conversation history when unified personal lookup is empty', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.message.findMany.mockResolvedValue([{ role: 'user', content: 'first personal msg' }]);
    getUnifiedConversationIds.mockResolvedValueOnce([]);

    await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(getUnifiedConversationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'ten_1',
        endUserId: 'eu_1',
        clawscaleUserId: 'csu_1',
        linkedTo: null,
      }),
    );
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_1'] },
        }),
      }),
    );
  });

  it('auto-selects the default backend for an existing personal-channel end user with no active backends', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      status: 'connected',
      scope: 'personal',
      ownerClawscaleUserId: 'csu_1',
      ownerClawscaleUser: { id: 'csu_1', cokeAccountId: 'acct_1' },
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [],
    });
    db.message.findMany.mockResolvedValue([{ role: 'user', content: 'historical' }]);

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '继续聊',
      meta: { platform: 'wechat_personal' },
    });

    expect(db.endUserBackend.upsert).toHaveBeenCalledWith({
      where: { endUserId_backendId: { endUserId: 'eu_1', backendId: 'ab_1' } },
      create: { endUserId: 'eu_1', backendId: 'ab_1' },
      update: {},
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          channelScope: 'personal',
          cokeAccountId: 'acct_1',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        reply: 'bridge ok',
      }),
    );
  });

  it('auto-selects the default backend for an existing shared-channel end user with no active backends', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      type: 'whatsapp_evolution',
      customerId: null,
      ownershipKind: 'shared',
      agentId: 'agent_shared',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: '8617807028761',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [],
    });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: '8617807028761',
      displayName: 'Alice',
      text: '继续聊',
      meta: { platform: 'whatsapp_evolution' },
    });

    expect(db.endUserBackend.upsert).toHaveBeenCalledWith({
      where: { endUserId_backendId: { endUserId: 'eu_1', backendId: 'ab_1' } },
      create: { endUserId: 'eu_1', backendId: 'ab_1' },
      update: {},
    });
    expect(result).toEqual(
      expect.objectContaining({
        reply: 'bridge ok',
      }),
    );
  });

  it('does not persist an empty assistant message when a backend defers to async delivery', async () => {
    db.channel.findUnique.mockResolvedValue({
      id: 'ch_1',
      tenantId: 'ten_1',
      type: 'whatsapp_evolution',
      customerId: null,
      ownershipKind: 'shared',
      agentId: 'agent_shared',
      status: 'connected',
      scope: 'tenant_shared',
      ownerClawscaleUserId: null,
      ownerClawscaleUser: null,
    });
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: '8617807028761',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    generateReply.mockResolvedValueOnce({ text: '', outputId: 'out_late_1' });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: '8617807028761',
      displayName: 'Alice',
      text: 'this one should fall back async',
      meta: { platform: 'whatsapp_evolution' },
    });

    expect(result).toEqual({
      conversationId: 'conv_1',
      replies: [],
      reply: '',
    });
    expect(db.message.create).toHaveBeenCalledTimes(1);
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv_1',
          role: 'user',
          content: 'this one should fall back async',
        }),
      }),
    );
  });

  it('uses the current conversation directly for ordinary inbound messages', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(db.endUser.findMany).not.toHaveBeenCalled();
    expect(db.conversation.findMany).not.toHaveBeenCalled();
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_1'] },
        }),
      }),
    );
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          channelScope: 'personal',
          clawscaleUserId: expect.anything(),
          cokeAccountId: expect.anything(),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
  });

  it('falls back to linkedTo when clawscaleUserId is absent', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_2',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_456',
      name: 'Bob',
      status: 'allowed',
      linkedTo: 'eu_legacy',
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }],
    });
    db.endUser.findMany.mockResolvedValue([{ id: 'eu_legacy' }, { id: 'eu_2' }]);
    db.conversation.findMany.mockResolvedValue([{ id: 'conv_legacy' }]);
    getUnifiedConversationIds.mockResolvedValueOnce(['conv_legacy']);

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_456',
      displayName: 'Bob',
      text: 'hello',
      meta: { platform: 'wechat_personal' },
    });

    expect(getUnifiedConversationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'ten_1',
        endUserId: 'eu_2',
        clawscaleUserId: null,
        linkedTo: 'eu_legacy',
      }),
    );
    expect(db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv_legacy'] },
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: 'bridge ok',
      }),
    );
  });

  it('keeps backend name prefixes when multiple active backends reply', async () => {
    db.endUser.findUnique.mockResolvedValue({
      id: 'eu_1',
      tenantId: 'ten_1',
      channelId: 'ch_1',
      externalId: 'wxid_123',
      name: 'Alice',
      status: 'allowed',
      linkedTo: null,
      clawscaleUserId: null,
      clawscaleUser: null,
      activeBackends: [{ backendId: 'ab_1' }, { backendId: 'ab_2' }],
    });
    db.aiBackend.findMany.mockResolvedValue([
      {
        id: 'ab_1',
        tenantId: 'ten_1',
        name: 'Coke Bridge',
        type: 'custom',
        config: {
          baseUrl: 'http://127.0.0.1:8090/bridge/inbound',
          responseFormat: 'json-auto',
        },
        isActive: true,
        isDefault: true,
      },
      {
        id: 'ab_2',
        tenantId: 'ten_1',
        name: 'Helper Bot',
        type: 'custom',
        config: {
          baseUrl: 'http://127.0.0.1:8091/bridge/inbound',
          responseFormat: 'json-auto',
        },
        isActive: true,
        isDefault: false,
      },
    ]);
    generateReply
      .mockResolvedValueOnce('bridge ok')
      .mockResolvedValueOnce('helper ok');

    const result = await routeInboundMessage({
      channelId: 'ch_1',
      externalId: 'wxid_123',
      displayName: 'Alice',
      text: '在吗',
      meta: { platform: 'wechat_personal' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 'conv_1',
        reply: '[Coke Bridge]\nbridge ok\n\n---\n\n[Helper Bot]\nhelper ok',
      }),
    );
  });
});
