const BLOCKED_ADMIN_ADD_CHANNEL_TYPES = new Set(['wechat_personal']);

export function isAdminAddChannelTypeAllowed(type: string): boolean {
  return !BLOCKED_ADMIN_ADD_CHANNEL_TYPES.has(type);
}
