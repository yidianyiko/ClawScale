import type { ApiResponse } from '../../shared/src/types/api';
import { cokeUserApi } from './coke-user-api';
export type {
  CustomerWechatChannelState as CokeUserWechatChannelState,
  CustomerWechatChannelStatus as CokeUserWechatChannelStatus,
  CustomerWechatChannelViewModel as CokeUserWechatChannelViewModel,
} from './customer-wechat-channel';
export {
  archiveCustomerWechatChannel,
  connectCustomerWechatChannel,
  createCustomerWechatChannel,
  disconnectCustomerWechatChannel,
  getCustomerWechatChannelStatus,
  getCustomerWechatChannelViewModel as getCokeUserWechatChannelViewModel,
} from './customer-wechat-channel';

import type { CustomerWechatChannelState } from './customer-wechat-channel';

function normalizeEmptyArchiveResponse(
  response: ApiResponse<CustomerWechatChannelState> | undefined,
): ApiResponse<CustomerWechatChannelState> {
  if (response == null) {
    return {
      ok: true,
      data: { status: 'archived' },
    };
  }

  return response;
}

export function createCokeUserWechatChannel() {
  return cokeUserApi.post<ApiResponse<CustomerWechatChannelState>>('/api/customer/channels/wechat-personal');
}

export function connectCokeUserWechatChannel() {
  return cokeUserApi.post<ApiResponse<CustomerWechatChannelState>>(
    '/api/customer/channels/wechat-personal/connect',
  );
}

export function getCokeUserWechatChannelStatus() {
  return cokeUserApi.get<ApiResponse<CustomerWechatChannelState>>(
    '/api/customer/channels/wechat-personal/status',
  );
}

export function disconnectCokeUserWechatChannel() {
  return cokeUserApi.post<ApiResponse<CustomerWechatChannelState>>(
    '/api/customer/channels/wechat-personal/disconnect',
  );
}

export function archiveCokeUserWechatChannel() {
  return cokeUserApi
    .delete<ApiResponse<CustomerWechatChannelState> | undefined>('/api/customer/channels/wechat-personal')
    .then(normalizeEmptyArchiveResponse);
}
