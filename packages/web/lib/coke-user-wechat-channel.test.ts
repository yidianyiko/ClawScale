import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveCustomerWechatChannel,
  connectCustomerWechatChannel,
  createCustomerWechatChannel,
  disconnectCustomerWechatChannel,
  getCustomerWechatChannelStatus,
} from './customer-wechat-channel';
import { messages } from './i18n';
import {
  getCokeUserWechatChannelStatus,
  getCokeUserWechatChannelViewModel,
} from './coke-user-wechat-channel';
import {
  applyCokeUserWechatChannelMutationResult,
  applyCokeUserWechatChannelMutationFailure,
  applyCokeUserWechatChannelRefreshFailure,
} from './coke-user-wechat-channel-machine';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('coke-user-wechat-channel api helpers', () => {
  it('does not leak neutral helper names through the coke compatibility module', async () => {
    const cokeWechatModule = await import('./coke-user-wechat-channel');

    expect(cokeWechatModule).not.toHaveProperty('createCustomerWechatChannel');
    expect(cokeWechatModule).not.toHaveProperty('connectCustomerWechatChannel');
    expect(cokeWechatModule).not.toHaveProperty('getCustomerWechatChannelStatus');
    expect(cokeWechatModule).not.toHaveProperty('disconnectCustomerWechatChannel');
    expect(cokeWechatModule).not.toHaveProperty('archiveCustomerWechatChannel');
    expect(cokeWechatModule).not.toHaveProperty('getCustomerWechatChannelViewModel');
  });

  it('calls the neutral personal channel create/connect/status/disconnect/archive endpoints', async () => {
    const { customerApi } = await import('./customer-api');
    const customerPostSpy = vi.spyOn(customerApi, 'post').mockResolvedValue({
      ok: true,
      data: { status: 'missing' },
    } as never);
    const customerGetSpy = vi.spyOn(customerApi, 'get').mockResolvedValue({
      ok: true,
      data: { status: 'missing' },
    } as never);
    const customerDeleteSpy = vi.spyOn(customerApi, 'delete').mockResolvedValue({
      ok: true,
      data: { status: 'archived' },
    } as never);
    await createCustomerWechatChannel();
    await connectCustomerWechatChannel();
    await getCustomerWechatChannelStatus();
    await disconnectCustomerWechatChannel();
    await archiveCustomerWechatChannel();

    expect(customerPostSpy).toHaveBeenNthCalledWith(1, '/api/customer/channels/wechat-personal');
    expect(customerPostSpy).toHaveBeenNthCalledWith(2, '/api/customer/channels/wechat-personal/connect');
    expect(customerPostSpy).toHaveBeenNthCalledWith(3, '/api/customer/channels/wechat-personal/disconnect');
    expect(customerGetSpy).toHaveBeenCalledWith('/api/customer/channels/wechat-personal/status');
    expect(customerDeleteSpy).toHaveBeenCalledWith('/api/customer/channels/wechat-personal');
  });

  it('prefers the stored customer token for the coke compatibility channel wrapper', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn((key: string) => {
            if (key === 'customer_token') return 'customer-token';
            if (key === 'coke_user_token') return 'legacy-token';
            return null;
          }),
        },
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data: { status: 'missing' } }),
    }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await getCokeUserWechatChannelStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/api/customer/channels/wechat-personal/status',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer customer-token',
        },
        body: undefined,
      },
    );
  });

  it('falls back to the coke token when no customer token is present', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://gateway.example.com';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn((key: string) => (key === 'coke_user_token' ? 'legacy-token' : null)),
        },
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data: { status: 'missing' } }),
    }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await getCokeUserWechatChannelStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/api/customer/channels/wechat-personal/status',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer legacy-token',
        },
        body: undefined,
      },
    );
  });

  it('normalizes an empty archive success into an archived channel state', async () => {
    const { customerApi } = await import('./customer-api');
    const customerDeleteSpy = vi.spyOn(customerApi, 'delete').mockResolvedValue(undefined as never);

    await expect(archiveCustomerWechatChannel()).resolves.toEqual({
      ok: true,
      data: { status: 'archived' },
    });

    expect(customerDeleteSpy).toHaveBeenCalledWith('/api/customer/channels/wechat-personal');
  });
});

describe('getCokeUserWechatChannelViewModel', () => {
  it('maps lifecycle states to the expected copy', () => {
    const copy = messages.en.customerPages.bindWechat.viewModel;

    expect(getCokeUserWechatChannelViewModel(null, copy)).toMatchObject({
      eyebrow: 'No channel yet',
      primaryActionLabel: 'Create my WeChat channel',
    });
    expect(getCokeUserWechatChannelViewModel({ status: 'disconnected' }, copy)).toMatchObject({
      title: 'Connect WeChat',
      primaryActionLabel: 'Connect WeChat',
    });
    expect(getCokeUserWechatChannelViewModel({ status: 'pending' }, copy)).toMatchObject({
      title: 'Scan the QR code to connect',
      primaryActionLabel: 'Refresh QR',
    });
    expect(
      getCokeUserWechatChannelViewModel({
        status: 'connected',
        masked_identity: 'wx***1234',
      }, copy),
    ).toMatchObject({
      eyebrow: 'Connected',
      primaryActionLabel: 'Disconnect WeChat',
      description: 'Your personal channel is live as wx***1234.',
    });
    expect(
      getCokeUserWechatChannelViewModel({
        status: 'error',
        error: 'Temporary bridge failure',
      }, copy),
    ).toMatchObject({
      eyebrow: 'Connection error',
      primaryActionLabel: 'Reconnect',
      secondaryActionLabel: 'Archive channel',
      description: 'The last connect attempt failed. You can retry or archive this channel.',
    });
    expect(getCokeUserWechatChannelViewModel({ status: 'archived' }, copy)).toMatchObject({
      title: 'This WeChat channel is archived',
      primaryActionLabel: 'Create my WeChat channel again',
    });
  });
});

describe('coke-user-wechat-channel state machine', () => {
  it('uses the mutation response immediately, including pending connect payloads', () => {
    const mutationResult = {
      status: 'pending',
      connect_url: 'https://wx.example.com/connect?session=abc',
      expires_at: 1234567890,
    } as const;

    expect(applyCokeUserWechatChannelMutationResult(mutationResult)).toEqual(mutationResult);
  });

  it('preserves an existing pending session when a transient refresh fails', () => {
    const current = {
      status: 'pending',
      connect_url: 'https://wx.example.com/connect?session=abc',
      expires_at: 1234567890,
    } as const;

    expect(
      applyCokeUserWechatChannelRefreshFailure(current, 'Temporary bridge failure'),
    ).toEqual({
      channel: current,
      transientError: 'Temporary bridge failure',
    });
  });

  it('preserves a missing channel when create fails and surfaces an action error', () => {
    expect(applyCokeUserWechatChannelMutationFailure({ status: 'missing' }, 'Temporary bridge failure')).toEqual(
      {
        channel: { status: 'missing' },
        actionError: 'Temporary bridge failure',
      },
    );
  });

  it('preserves a connected channel when archive fails and surfaces an action error', () => {
    expect(
      applyCokeUserWechatChannelMutationFailure(
        {
          status: 'connected',
          masked_identity: 'wx***1234',
        },
        'Temporary bridge failure',
      ),
    ).toEqual({
      channel: {
        status: 'connected',
        masked_identity: 'wx***1234',
      },
      actionError: 'Temporary bridge failure',
    });
  });
});
