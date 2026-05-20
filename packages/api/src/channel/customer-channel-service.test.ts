import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  channelServiceErrorToHttp,
  createCustomerChannelService,
  type CustomerChannelActionRequest,
  type CustomerChannelLifecycleAction,
  type CustomerChannelServiceErrorCode,
} from './customer-channel-service.js';

const mocks = vi.hoisted(() => ({
  resolveCokeAccountAccess: vi.fn(),
  ensureClawscaleUserForCustomer: vi.fn(),
  membershipFindFirst: vi.fn(),
}));

vi.mock('../lib/coke-account-access.js', () => ({
  resolveCokeAccountAccess: mocks.resolveCokeAccountAccess,
}));

vi.mock('../lib/clawscale-user.js', () => ({
  ensureClawscaleUserForCustomer: mocks.ensureClawscaleUserForCustomer,
}));

function createDb() {
  return {
    membership: {
      findFirst: mocks.membershipFindFirst,
    },
  };
}

function makeOwnerMembership(claimStatus: 'active' | 'pending' = 'active') {
  return {
    role: 'owner',
    customer: {
      id: 'ck_customer_1',
      displayName: 'Alice',
    },
    identity: {
      email: 'alice@example.com',
      claimStatus,
    },
  };
}

describe('customer channel service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membershipFindFirst.mockResolvedValue(makeOwnerMembership());
    mocks.resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://coke.example/account/subscription',
    });
    mocks.ensureClawscaleUserForCustomer.mockResolvedValue({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
      created: false,
      ready: true,
    });
  });

  it.each<[CustomerChannelServiceErrorCode, 401 | 402 | 403 | 404]>([
    ['unauthorized', 401],
    ['invalid_or_expired_token', 401],
    ['account_not_found', 404],
    ['claim_inactive', 403],
    ['account_suspended', 403],
    ['email_not_verified', 403],
    ['subscription_required', 402],
  ])('maps error %s to HTTP %d', (code, status) => {
    expect(channelServiceErrorToHttp({ code })).toEqual({
      status,
      body: { ok: false, error: code },
    });
  });

  it.each<CustomerChannelLifecycleAction>([
    'create',
    'connect',
    'disconnect',
    'delete',
    'status',
  ])('accepts lifecycle action %s in CustomerChannelActionRequest', (action) => {
    const request: CustomerChannelActionRequest = {
      action,
      customerId: 'ck_customer_1',
      identityId: 'identity_1',
    };

    expect(request.action).toBe(action);
  });

  it('enumerates every error code that the route layer expects', () => {
    const expected: CustomerChannelServiceErrorCode[] = [
      'unauthorized',
      'invalid_or_expired_token',
      'account_not_found',
      'claim_inactive',
      'account_suspended',
      'email_not_verified',
      'subscription_required',
    ];

    for (const code of expected) {
      const mapped = channelServiceErrorToHttp({ code });
      expect(mapped.body.ok).toBe(false);
      expect(mapped.body.error).toBe(code);
    }
  });

  it('resolves customer compatibility account access and ClawScale auth context', async () => {
    const service = createCustomerChannelService({ db: createDb() });

    await expect(
      service.resolvePersonalWechatAuth({
        action: 'status',
        customerId: 'ck_customer_1',
        identityId: 'idt_1',
      }),
    ).resolves.toEqual({
      tenantId: 'ten_1',
      clawscaleUserId: 'csu_1',
    });
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_customer_1',
        identityId: 'idt_1',
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
            email: true,
            claimStatus: true,
          },
        },
      },
    });
    expect(mocks.resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'ck_customer_1',
        status: 'normal',
        emailVerified: true,
        displayName: 'Alice',
      },
    });
    expect(mocks.ensureClawscaleUserForCustomer).toHaveBeenCalledWith({
      customerId: 'ck_customer_1',
    });
  });

  it('throws account_not_found when compatibility account lookup is missing', async () => {
    mocks.membershipFindFirst.mockResolvedValueOnce(null);
    const service = createCustomerChannelService({ db: createDb() });

    await expect(
      service.resolvePersonalWechatAuth({
        action: 'status',
        customerId: 'ck_customer_1',
        identityId: 'idt_1',
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' });
    expect(mocks.resolveCokeAccountAccess).not.toHaveBeenCalled();
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
  });

  it.each<CustomerChannelLifecycleAction>(['create', 'connect'])(
    'blocks %s when the account is suspended',
    async (action) => {
      mocks.resolveCokeAccountAccess.mockResolvedValueOnce({
        accountStatus: 'suspended',
        emailVerified: true,
        subscriptionActive: true,
        subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
        accountAccessAllowed: false,
        accountAccessDeniedReason: 'account_suspended',
        renewalUrl: 'https://coke.example/account/subscription',
      });
      const service = createCustomerChannelService({ db: createDb() });

      await expect(
        service.resolvePersonalWechatAuth({
          action,
          customerId: 'ck_customer_1',
          identityId: 'idt_1',
        }),
      ).rejects.toMatchObject({ code: 'account_suspended' });
      expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
    },
  );

  it('blocks connect when subscription is required', async () => {
    mocks.resolveCokeAccountAccess.mockResolvedValueOnce({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: false,
      subscriptionExpiresAt: null,
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'subscription_required',
      renewalUrl: 'https://coke.example/account/subscription',
    });
    const service = createCustomerChannelService({ db: createDb() });

    await expect(
      service.resolvePersonalWechatAuth({
        action: 'connect',
        customerId: 'ck_customer_1',
        identityId: 'idt_1',
      }),
    ).rejects.toMatchObject({ code: 'subscription_required' });
    expect(mocks.ensureClawscaleUserForCustomer).not.toHaveBeenCalled();
  });

  it.each<CustomerChannelLifecycleAction>(['create', 'delete', 'status'])(
    'does not block %s when subscription is required',
    async (action) => {
      mocks.resolveCokeAccountAccess.mockResolvedValueOnce({
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: false,
        subscriptionExpiresAt: null,
        accountAccessAllowed: false,
        accountAccessDeniedReason: 'subscription_required',
        renewalUrl: 'https://coke.example/account/subscription',
      });
      const service = createCustomerChannelService({ db: createDb() });

      await expect(
        service.resolvePersonalWechatAuth({
          action,
          customerId: 'ck_customer_1',
          identityId: 'idt_1',
        }),
      ).resolves.toEqual({
        tenantId: 'ten_1',
        clawscaleUserId: 'csu_1',
      });
    },
  );
});
