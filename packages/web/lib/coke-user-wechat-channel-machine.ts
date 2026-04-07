import type { CokeUserWechatChannelState } from './coke-user-wechat-channel';

export function applyCokeUserWechatChannelMutationResult(
  result: CokeUserWechatChannelState,
): CokeUserWechatChannelState {
  return result;
}

export function applyCokeUserWechatChannelMutationFailure(
  current: CokeUserWechatChannelState | null,
  error: string,
): {
  channel: CokeUserWechatChannelState;
  actionError: string | null;
} {
  if (current == null) {
    return {
      channel: {
        status: 'error',
        error,
      },
      actionError: null,
    };
  }

  return {
    channel: current,
    actionError: error,
  };
}

export function applyCokeUserWechatChannelRefreshFailure(
  current: CokeUserWechatChannelState | null,
  error: string,
): {
  channel: CokeUserWechatChannelState | null;
  transientError: string | null;
} {
  if (current?.status === 'pending') {
    return {
      channel: current,
      transientError: error,
    };
  }

  return {
    channel: {
      status: 'error',
      error,
    },
    transientError: null,
  };
}
