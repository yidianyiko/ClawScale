export type {
  CustomerWechatChannelState as CokeUserWechatChannelState,
  CustomerWechatChannelStatus as CokeUserWechatChannelStatus,
  CustomerWechatChannelViewModel as CokeUserWechatChannelViewModel,
} from './customer-wechat-channel';

import type { ApiResponse } from '../../shared/src/types/api';
import { getCokeUserToken } from './coke-user-auth';
import {
  type CustomerWechatChannelState,
  getCustomerWechatChannelViewModel,
} from './customer-wechat-channel';
import { createCustomerApiClient } from './customer-api';
import { getCustomerToken } from './customer-auth';

function getCokeCompatibilityChannelToken(): string | null {
  return getCustomerToken() ?? getCokeUserToken();
}

const cokeChannelCompatibilityApi = createCustomerApiClient(getCokeCompatibilityChannelToken);

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

export function getCokeUserWechatChannelViewModel(
  ...args: Parameters<typeof getCustomerWechatChannelViewModel>
) {
  return getCustomerWechatChannelViewModel(...args);
}

export function createCokeUserWechatChannel() {
  return cokeChannelCompatibilityApi.post<ApiResponse<CustomerWechatChannelState>>(
    '/api/customer/channels/wechat-personal',
  );
}

export function connectCokeUserWechatChannel() {
  return cokeChannelCompatibilityApi.post<ApiResponse<CustomerWechatChannelState>>(
    '/api/customer/channels/wechat-personal/connect',
  );
}

export function getCokeUserWechatChannelStatus() {
  return cokeChannelCompatibilityApi.get<ApiResponse<CustomerWechatChannelState>>(
    '/api/customer/channels/wechat-personal/status',
  );
}

export function disconnectCokeUserWechatChannel() {
  return cokeChannelCompatibilityApi.post<ApiResponse<CustomerWechatChannelState>>(
    '/api/customer/channels/wechat-personal/disconnect',
  );
}

export function archiveCokeUserWechatChannel() {
  return cokeChannelCompatibilityApi
    .delete<ApiResponse<CustomerWechatChannelState> | undefined>('/api/customer/channels/wechat-personal')
    .then(normalizeEmptyArchiveResponse);
}
