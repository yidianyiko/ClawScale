/**
 * Channel types — social platforms the bot can connect to.
 */
export type ChannelType =
  | 'whatsapp'
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
  | 'wechat_work';

export type ChannelStatus = 'connected' | 'disconnected' | 'pending' | 'error';

export interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  /** Opaque config — schema varies per channel type, contains secrets (admin-only) */
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelPayload {
  type: ChannelType;
  name: string;
  config: Record<string, unknown>;
}

export interface UpdateChannelPayload {
  name?: string;
  config?: Record<string, unknown>;
}

/** Per-channel-type config schemas (used for UI form generation) */
export const CHANNEL_CONFIG_SCHEMA: Record<ChannelType, { label: string; fields: ChannelConfigField[] }> = {
  whatsapp: {
    label: 'WhatsApp Business',
    fields: [
      { key: 'phoneNumber', label: 'Phone Number', type: 'text', required: true, placeholder: '+601234567890' },
    ],
  },
  telegram: {
    label: 'Telegram Bot',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...' },
    ],
  },
  slack: {
    label: 'Slack',
    fields: [
      { key: 'botToken', label: 'Bot OAuth Token', type: 'password', required: true, placeholder: 'xoxb-...' },
      { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true, placeholder: '' },
    ],
  },
  discord: {
    label: 'Discord',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '' },
      { key: 'applicationId', label: 'Application ID', type: 'text', required: true, placeholder: '' },
    ],
  },
  instagram: {
    label: 'Instagram (via Meta)',
    fields: [
      { key: 'accessToken', label: 'Page Access Token', type: 'password', required: true, placeholder: '' },
      { key: 'pageId', label: 'Page ID', type: 'text', required: true, placeholder: '' },
    ],
  },
  facebook: {
    label: 'Facebook Messenger',
    fields: [
      { key: 'accessToken', label: 'Page Access Token', type: 'password', required: true, placeholder: '' },
      { key: 'pageId', label: 'Page ID', type: 'text', required: true, placeholder: '' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'text', required: true, placeholder: '' },
    ],
  },
  line: {
    label: 'LINE',
    fields: [
      { key: 'channelAccessToken', label: 'Channel Access Token', type: 'password', required: true, placeholder: '' },
      { key: 'channelSecret', label: 'Channel Secret', type: 'password', required: true, placeholder: '' },
    ],
  },
  signal: {
    label: 'Signal',
    fields: [
      { key: 'phoneNumber', label: 'Phone Number', type: 'text', required: true, placeholder: '+601234567890' },
    ],
  },
  teams: {
    label: 'Microsoft Teams',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true, placeholder: '' },
      { key: 'appPassword', label: 'App Password', type: 'password', required: true, placeholder: '' },
    ],
  },
  matrix: {
    label: 'Matrix',
    fields: [
      { key: 'homeserverUrl', label: 'Homeserver URL', type: 'text', required: true, placeholder: 'https://matrix.org' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: '' },
    ],
  },
  web: {
    label: 'Web Chat Widget',
    fields: [],
  },
  wechat_work: {
    label: 'WeChat Work (WeCom)',
    fields: [
      { key: 'botId', label: 'Bot ID', type: 'text', required: true, placeholder: '' },
      { key: 'secret', label: 'Bot Secret', type: 'password', required: true, placeholder: '' },
    ],
  },
};

export interface ChannelConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  placeholder: string;
}
