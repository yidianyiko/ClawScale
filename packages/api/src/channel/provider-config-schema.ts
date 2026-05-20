import type { ChannelType } from '@clawscale/shared';

export interface ChannelConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  placeholder: string;
}

/** Per-channel-type config schemas owned by the backend Channel system. */
export const CHANNEL_CONFIG_SCHEMA: Record<ChannelType, { label: string; fields: ChannelConfigField[] }> = {
  whatsapp: {
    label: 'WhatsApp (Personal)',
    fields: [],
  },
  whatsapp_business: {
    label: 'WhatsApp Business API',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true, placeholder: '123456789012345 (not the phone number itself)' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'EAAxxxxxxx...' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'text', required: true, placeholder: 'any-secret-string-you-choose' },
    ],
  },
  whatsapp_evolution: {
    label: 'WhatsApp Evolution',
    fields: [],
  },
  wechat_ecloud: {
    label: 'WeChat Ecloud',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true, placeholder: '' },
      { key: 'token', label: 'Token', type: 'password', required: true, placeholder: '' },
      { key: 'baseUrl', label: 'Base URL', type: 'text', required: false, placeholder: 'https://api.geweapi.com' },
    ],
  },
  linq: {
    label: 'Linq',
    fields: [
      { key: 'fromNumber', label: 'From Number', type: 'text', required: false, placeholder: '+13213108456' },
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
      { key: 'appToken', label: 'App-Level Token (Socket Mode)', type: 'password', required: true, placeholder: 'xapp-...' },
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
      { key: 'signalCliUrl', label: 'signal-cli REST API URL', type: 'text', required: true, placeholder: 'http://localhost:8080' },
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
  wechat_personal: {
    label: 'WeChat Personal',
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
