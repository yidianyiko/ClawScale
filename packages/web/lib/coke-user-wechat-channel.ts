import type { ApiResponse } from '../../shared/src/types/api';
import type { LocaleMessages } from './i18n';
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

type CokeUserWechatChannelViewModelMessages = LocaleMessages['cokeUserPages']['bindWechat']['viewModel'];

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
  copy: CokeUserWechatChannelViewModelMessages,
): CokeUserWechatChannelViewModel {
  switch (channel?.status) {
    case 'disconnected':
      return {
        eyebrow: copy.disconnected.eyebrow,
        title: copy.disconnected.title,
        description: copy.disconnected.description,
        primaryActionLabel: copy.disconnected.primaryActionLabel,
      };
    case 'pending':
      return {
        eyebrow: copy.pending.eyebrow,
        title: copy.pending.title,
        description: copy.pending.description,
        primaryActionLabel: copy.pending.primaryActionLabel,
      };
    case 'connected':
      return {
        eyebrow: copy.connected.eyebrow,
        title: copy.connected.title,
        description: channel.masked_identity
          ? copy.connected.descriptionWithIdentity.replace('{identity}', channel.masked_identity)
          : copy.connected.descriptionWithoutIdentity,
        primaryActionLabel: copy.connected.primaryActionLabel,
      };
    case 'error':
      return {
        eyebrow: copy.error.eyebrow,
        title: copy.error.title,
        description: copy.error.descriptionFallback,
        primaryActionLabel: copy.error.primaryActionLabel,
        secondaryActionLabel: copy.error.secondaryActionLabel,
      };
    case 'archived':
      return {
        eyebrow: copy.archived.eyebrow,
        title: copy.archived.title,
        description: copy.archived.description,
        primaryActionLabel: copy.archived.primaryActionLabel,
      };
    case 'missing':
    default:
      return {
        eyebrow: copy.missing.eyebrow,
        title: copy.missing.title,
        description: copy.missing.description,
        primaryActionLabel: copy.missing.primaryActionLabel,
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
