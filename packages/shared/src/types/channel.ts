/**
 * Channel types — social platforms the bot can connect to.
 */
// Frontend-safe channel enums/read DTOs only. Provider config schemas live in
// gateway/packages/api/src/channel/provider-config-schema.ts; see
// docs/design-docs/channel-field-inventory.md for field classification.
export type ChannelType =
  | 'whatsapp'
  | 'whatsapp_business'
  | 'whatsapp_evolution'
  | 'wechat_ecloud'
  | 'linq'
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'instagram'
  | 'facebook'
  | 'line'
  | 'signal'
  | 'teams'
  | 'matrix'
  | 'web'
  | 'wechat_work'
  | 'wechat_personal';

export type ChannelStatus = 'connected' | 'disconnected' | 'pending' | 'error';
