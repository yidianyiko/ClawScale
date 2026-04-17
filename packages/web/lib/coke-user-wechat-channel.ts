export type {
  CustomerWechatChannelState as CokeUserWechatChannelState,
  CustomerWechatChannelStatus as CokeUserWechatChannelStatus,
  CustomerWechatChannelViewModel as CokeUserWechatChannelViewModel,
} from './customer-wechat-channel';

import {
  archiveCustomerWechatChannel,
  connectCustomerWechatChannel,
  createCustomerWechatChannel,
  disconnectCustomerWechatChannel,
  getCustomerWechatChannelViewModel,
  getCustomerWechatChannelStatus,
} from './customer-wechat-channel';

export function getCokeUserWechatChannelViewModel(
  ...args: Parameters<typeof getCustomerWechatChannelViewModel>
) {
  return getCustomerWechatChannelViewModel(...args);
}

export function createCokeUserWechatChannel() {
  return createCustomerWechatChannel();
}

export function connectCokeUserWechatChannel() {
  return connectCustomerWechatChannel();
}

export function getCokeUserWechatChannelStatus() {
  return getCustomerWechatChannelStatus();
}

export function disconnectCokeUserWechatChannel() {
  return disconnectCustomerWechatChannel();
}

export function archiveCokeUserWechatChannel() {
  return archiveCustomerWechatChannel();
}
