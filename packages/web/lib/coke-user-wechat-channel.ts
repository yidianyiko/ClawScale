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

import {
  archiveCustomerWechatChannel,
  connectCustomerWechatChannel,
  createCustomerWechatChannel,
  disconnectCustomerWechatChannel,
  getCustomerWechatChannelStatus,
} from './customer-wechat-channel';

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
