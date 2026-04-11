import type { ApiResponse } from '@clawscale/shared';
import { cokeUserApi } from './coke-user-api';

export type CokeUserWechatChannelStatus =
  | 'missing'
  | 'disconnected'
  | 'pending'
  | 'connected'
  | 'error'
  | 'archived';

export interface CokeUserWechatChannelState {
  status: CokeUserWechatChannelStatus;
  connect_url?: string;
  expires_at?: number;
  masked_identity?: string;
  error?: string;
  message?: string;
}

export interface CokeUserWechatChannelViewModel {
  eyebrow: string;
  title: string;
  description: string;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
}

function normalizeEmptyArchiveResponse(
  response: ApiResponse<CokeUserWechatChannelState> | undefined,
): ApiResponse<CokeUserWechatChannelState> {
  if (response == null) {
    return {
      ok: true,
      data: { status: 'archived' },
    };
  }

  return response;
}

export function getCokeUserWechatChannelViewModel(
  channel: Pick<CokeUserWechatChannelState, 'status' | 'masked_identity' | 'error'> | null,
): CokeUserWechatChannelViewModel {
  switch (channel?.status) {
    case 'disconnected':
      return {
        eyebrow: 'Channel created',
        title: 'Connect WeChat',
        description: 'Your personal WeChat channel exists. Start a QR login session to bring it online.',
        primaryActionLabel: 'Connect WeChat',
      };
    case 'pending':
      return {
        eyebrow: 'QR login in progress',
        title: 'Scan the QR code to connect',
        description: 'Use the QR below to log your personal channel into WeChat.',
        primaryActionLabel: 'Refresh QR',
      };
    case 'connected':
      return {
        eyebrow: 'Connected',
        title: 'WeChat is connected',
        description: `Your personal channel is live${channel.masked_identity ? ` as ${channel.masked_identity}` : ''}.`,
        primaryActionLabel: 'Disconnect WeChat',
      };
    case 'error':
      return {
        eyebrow: 'Connection error',
        title: 'Reconnect or archive your channel',
        description: channel.error ?? 'The last connect attempt failed. You can retry or archive this channel.',
        primaryActionLabel: 'Reconnect',
        secondaryActionLabel: 'Archive channel',
      };
    case 'archived':
      return {
        eyebrow: 'Archived',
        title: 'This WeChat channel is archived',
        description: 'Create a fresh personal channel if you want to use WeChat again.',
        primaryActionLabel: 'Create my WeChat channel again',
      };
    case 'missing':
    default:
      return {
        eyebrow: 'No channel yet',
        title: 'Create my WeChat channel',
        description: 'Create a personal WeChat channel for this Coke account, then connect it with a QR login.',
        primaryActionLabel: 'Create my WeChat channel',
      };
  }
}

export function createCokeUserWechatChannel(): Promise<ApiResponse<CokeUserWechatChannelState>> {
  return cokeUserApi.post<ApiResponse<CokeUserWechatChannelState>>('/api/coke/wechat-channel');
}

export function connectCokeUserWechatChannel(): Promise<ApiResponse<CokeUserWechatChannelState>> {
  return cokeUserApi.post<ApiResponse<CokeUserWechatChannelState>>('/api/coke/wechat-channel/connect');
}

export function getCokeUserWechatChannelStatus(): Promise<ApiResponse<CokeUserWechatChannelState>> {
  return cokeUserApi.get<ApiResponse<CokeUserWechatChannelState>>('/api/coke/wechat-channel/status');
}

export function disconnectCokeUserWechatChannel(): Promise<ApiResponse<CokeUserWechatChannelState>> {
  return cokeUserApi.post<ApiResponse<CokeUserWechatChannelState>>('/api/coke/wechat-channel/disconnect');
}

export function archiveCokeUserWechatChannel(): Promise<ApiResponse<CokeUserWechatChannelState>> {
  return cokeUserApi
    .delete<ApiResponse<CokeUserWechatChannelState> | undefined>('/api/coke/wechat-channel')
    .then(normalizeEmptyArchiveResponse);
}
