import { afterEach, describe, expect, it, vi } from 'vitest';
import { customerApi } from './customer-api';
import { messages } from './i18n';
import {
  archiveCokeUserWechatChannel,
  archiveCustomerWechatChannel,
  connectCokeUserWechatChannel,
  connectCustomerWechatChannel,
  createCokeUserWechatChannel,
  createCustomerWechatChannel,
  disconnectCokeUserWechatChannel,
  disconnectCustomerWechatChannel,
  getCustomerWechatChannelStatus,
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
  it('delegates the coke wrapper helpers to the neutral customer helper module', async () => {
    vi.resetModules();

    const createCustomerWechatChannelMock = vi.fn().mockResolvedValue({ ok: true, data: { status: 'missing' } });
    const connectCustomerWechatChannelMock = vi.fn().mockResolvedValue({ ok: true, data: { status: 'pending' } });
    const getCustomerWechatChannelStatusMock = vi.fn().mockResolvedValue({ ok: true, data: { status: 'connected' } });
    const disconnectCustomerWechatChannelMock = vi.fn().mockResolvedValue({ ok: true, data: { status: 'disconnected' } });
    const archiveCustomerWechatChannelMock = vi.fn().mockResolvedValue({ ok: true, data: { status: 'archived' } });

    vi.doMock('./customer-wechat-channel', async () => {
      const actual = await vi.importActual<typeof import('./customer-wechat-channel')>('./customer-wechat-channel');
      return {
        ...actual,
        createCustomerWechatChannel: createCustomerWechatChannelMock,
        connectCustomerWechatChannel: connectCustomerWechatChannelMock,
        getCustomerWechatChannelStatus: getCustomerWechatChannelStatusMock,
        disconnectCustomerWechatChannel: disconnectCustomerWechatChannelMock,
        archiveCustomerWechatChannel: archiveCustomerWechatChannelMock,
      };
    });

    const cokeWrapperModule = await import('./coke-user-wechat-channel');

    await cokeWrapperModule.createCokeUserWechatChannel();
    await cokeWrapperModule.connectCokeUserWechatChannel();
    await cokeWrapperModule.getCokeUserWechatChannelStatus();
    await cokeWrapperModule.disconnectCokeUserWechatChannel();
    await cokeWrapperModule.archiveCokeUserWechatChannel();

    expect(createCustomerWechatChannelMock).toHaveBeenCalledTimes(1);
    expect(connectCustomerWechatChannelMock).toHaveBeenCalledTimes(1);
    expect(getCustomerWechatChannelStatusMock).toHaveBeenCalledTimes(1);
    expect(disconnectCustomerWechatChannelMock).toHaveBeenCalledTimes(1);
    expect(archiveCustomerWechatChannelMock).toHaveBeenCalledTimes(1);

    vi.doUnmock('./customer-wechat-channel');
    vi.resetModules();
  });

  it('calls the neutral personal channel create/connect/status/disconnect/archive endpoints', async () => {
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

  it('normalizes an empty archive success into an archived channel state', async () => {
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
    const copy = messages.en.cokeUserPages.bindWechat.viewModel;

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
