import { afterEach, describe, expect, it, vi } from 'vitest';
import { cokeUserApi } from './coke-user-api';
import { messages } from './i18n';
import {
  archiveCokeUserWechatChannel,
  connectCokeUserWechatChannel,
  createCokeUserWechatChannel,
  disconnectCokeUserWechatChannel,
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
  it('calls the personal channel create/connect/status/disconnect/archive endpoints', async () => {
    const postSpy = vi.spyOn(cokeUserApi, 'post').mockResolvedValue({
      ok: true,
      data: { status: 'missing' },
    } as never);
    const getSpy = vi.spyOn(cokeUserApi, 'get').mockResolvedValue({
      ok: true,
      data: { status: 'missing' },
    } as never);
    const deleteSpy = vi.spyOn(cokeUserApi, 'delete').mockResolvedValue({
      ok: true,
      data: { status: 'archived' },
    } as never);

    await createCokeUserWechatChannel();
    await connectCokeUserWechatChannel();
    await getCokeUserWechatChannelStatus();
    await disconnectCokeUserWechatChannel();
    await archiveCokeUserWechatChannel();

    expect(postSpy).toHaveBeenNthCalledWith(1, '/api/coke/wechat-channel');
    expect(postSpy).toHaveBeenNthCalledWith(2, '/api/coke/wechat-channel/connect');
    expect(postSpy).toHaveBeenNthCalledWith(3, '/api/coke/wechat-channel/disconnect');
    expect(getSpy).toHaveBeenCalledWith('/api/coke/wechat-channel/status');
    expect(deleteSpy).toHaveBeenCalledWith('/api/coke/wechat-channel');
  });

  it('normalizes an empty archive success into an archived channel state', async () => {
    const deleteSpy = vi.spyOn(cokeUserApi, 'delete').mockResolvedValue(undefined as never);

    await expect(archiveCokeUserWechatChannel()).resolves.toEqual({
      ok: true,
      data: { status: 'archived' },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/api/coke/wechat-channel');
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
