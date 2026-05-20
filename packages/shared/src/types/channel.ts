/**
 * Channel types — social platforms the bot can connect to.
 */
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
