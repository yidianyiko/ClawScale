import {
  AI_PROVIDER_LABELS,
  AI_PROVIDER_TYPES,
  BACKEND_TYPE_DESCRIPTORS,
  type AiBackendType,
  type BackendFieldDef,
  type BackendTypeDescriptor,
} from '../../shared/src/types/ai-backend';
import {
  CHANNEL_CONFIG_SCHEMA,
  type ChannelConfigField,
  type ChannelType,
} from '../../shared/src/types/channel';

import type { Locale } from './i18n';

type ChannelFieldOverride = Partial<Pick<ChannelConfigField, 'label' | 'placeholder'>>;
type ChannelSchemaOverride = {
  label?: string;
  fields?: Partial<Record<string, ChannelFieldOverride>>;
};

type BackendFieldOverride = Partial<Pick<BackendFieldDef, 'label' | 'hint'>>;
type BackendDescriptorOverride = {
  label?: string;
  fields?: Partial<
    Record<
      string,
      BackendFieldOverride & {
        selectOptions?: Record<string, string>;
      }
    >
  >;
};

const CHANNEL_SCHEMA_OVERRIDES: Record<Locale, Partial<Record<ChannelType, ChannelSchemaOverride>>> = {
  en: {},
  zh: {
    whatsapp: {
      label: 'WhatsApp（个人）',
    },
    whatsapp_business: {
      label: 'WhatsApp Business API',
      fields: {
        phoneNumberId: {
          label: '电话号码 ID',
          placeholder: '123456789012345（不是手机号本身）',
        },
        accessToken: {
          label: '访问令牌',
        },
        verifyToken: {
          label: 'Webhook 验证令牌',
          placeholder: '你自定义的任意密钥字符串',
        },
      },
    },
    telegram: {
      label: 'Telegram 机器人',
      fields: {
        botToken: {
          label: '机器人令牌',
        },
      },
    },
    slack: {
      label: 'Slack',
      fields: {
        botToken: {
          label: '机器人 OAuth 令牌',
        },
        appToken: {
          label: '应用级令牌（Socket Mode）',
        },
      },
    },
    discord: {
      label: 'Discord',
      fields: {
        botToken: {
          label: '机器人令牌',
        },
        applicationId: {
          label: '应用 ID',
        },
      },
    },
    instagram: {
      label: 'Instagram（通过 Meta）',
      fields: {
        accessToken: {
          label: '页面访问令牌',
        },
        pageId: {
          label: '页面 ID',
        },
      },
    },
    facebook: {
      label: 'Facebook Messenger',
      fields: {
        accessToken: {
          label: '页面访问令牌',
        },
        pageId: {
          label: '页面 ID',
        },
        verifyToken: {
          label: 'Webhook 验证令牌',
        },
      },
    },
    line: {
      label: 'LINE',
      fields: {
        channelAccessToken: {
          label: '频道访问令牌',
        },
        channelSecret: {
          label: '频道密钥',
        },
      },
    },
    signal: {
      label: 'Signal',
      fields: {
        phoneNumber: {
          label: '手机号',
        },
        signalCliUrl: {
          label: 'signal-cli REST API 地址',
        },
      },
    },
    teams: {
      label: 'Microsoft Teams',
      fields: {
        appId: {
          label: '应用 ID',
        },
        appPassword: {
          label: '应用密码',
        },
      },
    },
    matrix: {
      label: 'Matrix',
      fields: {
        homeserverUrl: {
          label: 'Homeserver 地址',
        },
        accessToken: {
          label: '访问令牌',
        },
      },
    },
    web: {
      label: '网页聊天组件',
    },
    wechat_personal: {
      label: '微信个人号',
    },
    wechat_work: {
      label: '企业微信（WeCom）',
      fields: {
        botId: {
          label: '机器人 ID',
        },
        secret: {
          label: '机器人密钥',
        },
      },
    },
  },
};

const BACKEND_DESCRIPTOR_OVERRIDES: Record<
  Locale,
  Partial<Record<AiBackendType, BackendDescriptorOverride>>
> = {
  en: {},
  zh: {
    llm: {
      label: '大语言模型',
      fields: {
        apiKey: { label: 'API 密钥' },
        model: { label: '模型' },
        baseUrl: { label: '基础 URL', hint: '使用 OpenAI 时留空，兼容提供商可填写' },
        systemPrompt: { label: '系统提示词' },
      },
    },
    openclaw: {
      label: 'OpenClaw',
      fields: {
        baseUrl: { label: '基础 URL', hint: '会自动追加 /v1' },
        apiKey: { label: 'API 密钥' },
        model: { label: '模型' },
      },
    },
    palmos: {
      label: 'Palmos',
      fields: {
        apiKey: { label: 'API 密钥', hint: '将作为 Bearer Token 发送' },
      },
    },
    'claude-code': {
      label: 'Claude Code',
      fields: {
        baseUrl: { label: '通道服务 URL' },
        apiKey: { label: 'API 密钥' },
        authHeader: { label: 'Authorization 请求头', hint: '如填写则优先于 API 密钥' },
        systemPrompt: { label: '系统提示词' },
      },
    },
    custom: {
      label: '自定义后端',
      fields: {
        baseUrl: { label: '端点 URL' },
        transport: {
          label: '传输方式',
          selectOptions: {
            http: 'HTTP',
            sse: 'SSE',
            websocket: 'WebSocket',
          },
        },
        responseFormat: {
          label: '响应格式',
          selectOptions: {
            'json-auto': 'JSON（自动识别）',
            langgraph: 'LangGraph SSE',
            'raw-text': '纯文本',
          },
        },
        apiKey: { label: 'API 密钥' },
        authHeader: { label: 'Authorization 请求头' },
        systemPrompt: { label: '系统提示词' },
      },
    },
    'cli-bridge': {
      label: 'CLI 桥接',
      fields: {
        bridgeToken: {
          label: '桥接令牌',
          hint: '系统自动生成。连接 CLI bridge 时使用这个令牌。',
        },
      },
    },
  },
};

function localizeChannelSchema(locale: Locale) {
  const overrides = CHANNEL_SCHEMA_OVERRIDES[locale];

  return Object.fromEntries(
    Object.entries(CHANNEL_CONFIG_SCHEMA).map(([type, schema]) => {
      const override = overrides[type as ChannelType];
      const fields = schema.fields.map((field) => {
        const fieldOverride = override?.fields?.[field.key];
        return {
          ...field,
          label: fieldOverride?.label ?? field.label,
          placeholder: fieldOverride?.placeholder ?? field.placeholder,
        };
      });

      return [
        type,
        {
          ...schema,
          label: override?.label ?? schema.label,
          fields,
        },
      ];
    }),
  ) as typeof CHANNEL_CONFIG_SCHEMA;
}

function localizeBackendDescriptors(locale: Locale) {
  const overrides = BACKEND_DESCRIPTOR_OVERRIDES[locale];

  return Object.fromEntries(
    Object.entries(BACKEND_TYPE_DESCRIPTORS).map(([type, descriptor]) => {
      const override = overrides[type as AiBackendType];
      const fields = descriptor.fields.map((field) => {
        const fieldOverride = override?.fields?.[field.key];
        const selectOptions = field.selectOptions?.map((option) => ({
          ...option,
          label: fieldOverride?.selectOptions?.[option.value] ?? option.label,
        }));

        return {
          ...field,
          label: fieldOverride?.label ?? field.label,
          hint: fieldOverride?.hint ?? field.hint,
          selectOptions,
        };
      });

      return [
        type,
        {
          ...descriptor,
          label: override?.label ?? descriptor.label,
          fields,
        },
      ];
    }),
  ) as Record<AiBackendType, BackendTypeDescriptor>;
}

const CHANNEL_PAGE_COPY = {
  en: {
    pageTitle: 'Channels',
    pageDescription: 'Connect messaging platforms to your AI assistant.',
    genericError: 'Unable to update this channel right now.',
    addChannelButton: 'Add channel',
    addModalTitle: 'Add a channel',
    platformLabel: 'Platform',
    displayNameLabel: 'Display name',
    displayNamePlaceholderPrefix: 'My',
    addWhatsappHint: 'After adding, click Connect to get a QR code to scan with your phone.',
    addSubmit: 'Add channel',
    cancel: 'Cancel',
    qrTitle: 'Scan QR Code',
    qrImageAlt: 'QR Code',
    qrInstructions: {
      whatsapp: 'Open WhatsApp -> Linked Devices -> Link a device',
      wechat_personal: 'Open WeChat -> Me -> WeChat ID -> scan the code',
      default: 'Scan the QR code with your mobile device',
    },
    qrCopy: 'Copy',
    qrPending: 'Waiting for scan...',
    qrGenerating: 'Generating QR...',
    editModalTitle: 'Edit channel',
    noSettings: 'This channel type has no configurable settings.',
    saveChanges: 'Save changes',
    emptyTitle: 'No channels yet',
    emptyDescription:
      'Connect WhatsApp, Telegram, Discord, and more to start routing messages through your AI assistant.',
    addFirstChannel: 'Add your first channel',
    connect: 'Connect',
    disconnect: 'Disconnect',
    showQr: 'Show QR',
    connecting: 'Connecting...',
    settingsTitle: 'Settings',
    deleteTitle: 'Delete channel',
    deleteConfirm: 'Delete this channel? This cannot be undone.',
    status: {
      connected: 'Connected',
      disconnected: 'Disconnected',
      pending: 'Pending',
      error: 'Error',
    },
    webhook: {
      showSetup: 'how to set up',
      hideSetup: 'hide setup',
      intro:
        'In the Meta App Dashboard, go to WhatsApp -> Configuration and set:',
      callbackUrl: 'Callback URL:',
      verifyToken: 'Verify token:',
      verifyTokenValue: 'the token you entered when creating this channel.',
      webhookFields: 'Webhook fields:',
      webhookFieldsValue: 'subscribe to messages',
      setupInstructions: 'Setup instructions:',
      copyTitle: 'Copy',
      copiedTitle: 'Copied',
    },
  },
  zh: {
    pageTitle: '渠道',
    pageDescription: '将消息平台连接到你的 AI 助手。',
    genericError: '暂时无法更新渠道，请稍后再试。',
    addChannelButton: '添加渠道',
    addModalTitle: '添加渠道',
    platformLabel: '平台',
    displayNameLabel: '显示名称',
    displayNamePlaceholderPrefix: '我的',
    addWhatsappHint: '添加后，点击“连接”即可获取二维码并用手机扫码。',
    addSubmit: '添加渠道',
    cancel: '取消',
    qrTitle: '扫码连接',
    qrImageAlt: '二维码',
    qrInstructions: {
      whatsapp: '打开 WhatsApp -> 已关联设备 -> 关联设备',
      wechat_personal: '打开微信 -> 我 -> 微信号 -> 扫码',
      default: '请使用移动设备扫描二维码',
    },
    qrCopy: '复制',
    qrPending: '等待扫码...',
    qrGenerating: '正在生成二维码...',
    editModalTitle: '编辑渠道',
    noSettings: '该渠道类型没有可配置项。',
    saveChanges: '保存更改',
    emptyTitle: '还没有渠道',
    emptyDescription: '连接 WhatsApp、Telegram、Discord 等平台后，即可通过你的 AI 助手转发和处理消息。',
    addFirstChannel: '添加第一个渠道',
    connect: '连接',
    disconnect: '断开连接',
    showQr: '显示二维码',
    connecting: '连接中...',
    settingsTitle: '设置',
    deleteTitle: '删除渠道',
    deleteConfirm: '确定删除这个渠道吗？此操作无法撤销。',
    status: {
      connected: '已连接',
      disconnected: '未连接',
      pending: '等待中',
      error: '错误',
    },
    webhook: {
      showSetup: '查看配置方法',
      hideSetup: '隐藏配置方法',
      intro: '在 Meta App Dashboard 中进入 WhatsApp -> Configuration，并设置以下内容：',
      callbackUrl: '回调 URL：',
      verifyToken: '验证令牌：',
      verifyTokenValue: '使用你创建该渠道时填写的令牌。',
      webhookFields: 'Webhook 字段：',
      webhookFieldsValue: '订阅 messages',
      setupInstructions: '配置说明：',
      copyTitle: '复制',
      copiedTitle: '已复制',
    },
  },
} satisfies Record<Locale, Record<string, unknown>>;

const AI_BACKEND_PAGE_COPY = {
  en: {
    pageTitle: 'AI Backends',
    pageDescription:
      'ClawScale greets users and routes them to a backend. Configure the orchestrator below, then add the AI backends users can choose from.',
    adminOnly: 'Only admins can manage AI backends.',
    genericError: 'Unable to update this backend right now.',
    addBackendButton: 'Add backend',
    editBackendTitle: 'Edit backend',
    newBackendTitle: 'New backend',
    nameLabel: 'Name',
    namePlaceholder: 'e.g. GPT-4o',
    upstreamTypeLabel: 'Upstream type',
    commandAliasLabel: 'Command alias',
    commandAliasPlaceholder: 'e.g. gpt',
    optional: '(optional)',
    commandAliasHint:
      'Short name for slash commands. Users can type /{alias} hello to message this backend directly.',
    activeLabel: 'Active (visible to end-users)',
    defaultLabel: 'Set as default (auto-selected for new users, skips the menu)',
    saveChanges: 'Save changes',
    createBackend: 'Create backend',
    cancel: 'Cancel',
    emptyTitle: 'No AI backends yet',
    emptyDescription:
      "Without a backend, ClawScale will present a menu - but there's nothing to choose from.",
    addFirstBackend: 'Add your first backend',
    defaultBadge: 'Default',
    inactiveBadge: 'Inactive',
    setDefaultTitle: 'Set as default',
    removeDefaultTitle: 'Remove as default',
    editTitle: 'Edit',
    deleteTitle: 'Delete',
    deleteConfirm: 'Delete this backend? This cannot be undone.',
    clawscale: {
      sectionTitle: 'ClawScale Orchestrator',
      defaultName: 'ClawScale Assistant',
      builtIn: 'Built-in',
      disabled: 'Disabled',
      description:
        'Greets users, answers ClawScale questions, and routes to regular backends.',
      lockedNote:
        'Selection prompt is locked - name, visibility, and answer style can be changed.',
      modelLabel: 'Model',
      clearModelTitle: 'Clear model',
      apiKeyLabel: 'API key',
      apiKeyConfigured: 'configured',
      apiKeyMissing: 'not set',
      noLlmConfigured: 'No LLM configured - agent will not respond to messages.',
      inlineApiKeyPlaceholder: 'API key (sk-...)',
      inlineSet: 'Set',
      answerStyleLabel: 'Style',
      editSettingsTitle: 'Edit ClawScale settings',
      editTitle: 'Edit ClawScale Orchestrator',
      displayNameLabel: 'Display name',
      answerStyleFieldLabel: 'Answer style',
      answerStylePlaceholder: `e.g. "Always be concise. End with 'Have a great day!'"`,
      answerStyleHint:
        'Appended to knowledge-base and off-topic replies. The backend-selection menu is always shown as-is.',
      llmModelLabel: 'LLM Model',
      llmModelRequired: '(required for conversational agent)',
      llmModelHint:
        'LangChain model string. Examples: openai:gpt-5.4-mini, anthropic:claude-haiku-4-5-20251001, openrouter:openai/gpt-4o',
      apiKeyFieldLabel: 'API Key',
      apiKeyRequired: '(required)',
      apiKeySaved: 'API key is saved. Enter a new value to replace it.',
      activeCheckbox: 'Active (responds to users before a backend is selected)',
      save: 'Save',
      genericError: 'Unable to save ClawScale settings right now.',
    },
    providerFields: {
      textareaPlaceholder: 'You are a helpful assistant.',
      bridgeTokenLabel: 'Bridge Token',
      bridgeTokenHint: 'Use this token when connecting the local bridge.',
      bridgeTokenPending: 'A bridge token will be generated when you create this backend.',
      setupInstructions: 'Setup instructions:',
    },
  },
  zh: {
    pageTitle: 'AI 后端',
    pageDescription: 'ClawScale 会先接待用户并将其路由到具体后端。请先配置下方编排器，再添加用户可选择的 AI 后端。',
    adminOnly: '只有管理员可以管理 AI 后端。',
    genericError: '暂时无法更新后端，请稍后再试。',
    addBackendButton: '添加后端',
    editBackendTitle: '编辑后端',
    newBackendTitle: '新建后端',
    nameLabel: '名称',
    namePlaceholder: '例如 GPT-4o',
    upstreamTypeLabel: '上游类型',
    commandAliasLabel: '命令别名',
    commandAliasPlaceholder: '例如 gpt',
    optional: '（可选）',
    commandAliasHint: '用于斜杠命令的短名称。用户可以输入 /{alias} hello 直接向该后端发消息。',
    activeLabel: '启用（对终端用户可见）',
    defaultLabel: '设为默认（新用户自动选中，并跳过菜单）',
    saveChanges: '保存更改',
    createBackend: '创建后端',
    cancel: '取消',
    emptyTitle: '还没有 AI 后端',
    emptyDescription: '如果没有后端，ClawScale 仍会展示菜单，但用户没有可选项。',
    addFirstBackend: '添加第一个后端',
    defaultBadge: '默认',
    inactiveBadge: '未启用',
    setDefaultTitle: '设为默认',
    removeDefaultTitle: '取消默认',
    editTitle: '编辑',
    deleteTitle: '删除',
    deleteConfirm: '确定删除这个后端吗？此操作无法撤销。',
    clawscale: {
      sectionTitle: 'ClawScale 编排器',
      defaultName: 'ClawScale 助手',
      builtIn: '内置',
      disabled: '已停用',
      description: '负责接待用户、回答 ClawScale 相关问题，并将用户路由到常规后端。',
      lockedNote: '选择菜单提示词已锁定，但你仍可修改名称、可见性和回答风格。',
      modelLabel: '模型',
      clearModelTitle: '清除模型',
      apiKeyLabel: 'API 密钥',
      apiKeyConfigured: '已配置',
      apiKeyMissing: '未设置',
      noLlmConfigured: '尚未配置 LLM，智能体将无法回复消息。',
      inlineApiKeyPlaceholder: 'API 密钥（sk-...）',
      inlineSet: '设置',
      answerStyleLabel: '风格',
      editSettingsTitle: '编辑 ClawScale 设置',
      editTitle: '编辑 ClawScale 编排器',
      displayNameLabel: '显示名称',
      answerStyleFieldLabel: '回答风格',
      answerStylePlaceholder: '例如“始终简洁，并以‘祝你今天顺利！’结尾。”',
      answerStyleHint: '会附加到知识库回复和偏题回复中；后端选择菜单会保持原样显示。',
      llmModelLabel: 'LLM 模型',
      llmModelRequired: '（对话智能体必填）',
      llmModelHint:
        'LangChain 模型字符串，例如：openai:gpt-5.4-mini、anthropic:claude-haiku-4-5-20251001、openrouter:openai/gpt-4o',
      apiKeyFieldLabel: 'API 密钥',
      apiKeyRequired: '（必填）',
      apiKeySaved: 'API 密钥已保存。如需替换，请输入新值。',
      activeCheckbox: '启用（在用户选择后端前先参与回复）',
      save: '保存',
      genericError: '暂时无法保存 ClawScale 设置，请稍后再试。',
    },
    providerFields: {
      textareaPlaceholder: '你是一个乐于助人的助手。',
      bridgeTokenLabel: '桥接令牌',
      bridgeTokenHint: '连接本地 bridge 时使用这个令牌。',
      bridgeTokenPending: '创建后端时会自动生成桥接令牌。',
      setupInstructions: '配置说明：',
    },
  },
} satisfies Record<Locale, Record<string, unknown>>;

export function getLocalizedChannelCopy(locale: Locale) {
  const pageCopy = CHANNEL_PAGE_COPY[locale];
  const schema = localizeChannelSchema(locale);

  return {
    ...pageCopy,
    schema,
    schemaLabelByType: Object.fromEntries(
      Object.entries(schema).map(([type, value]) => [type, value.label]),
    ) as Record<ChannelType, string>,
  };
}

export function getLocalizedAiBackendCopy(locale: Locale) {
  const pageCopy = AI_BACKEND_PAGE_COPY[locale];
  const descriptors = localizeBackendDescriptors(locale);
  const providerLabels = Object.fromEntries(
    AI_PROVIDER_TYPES.map((type) => [type, descriptors[type]?.label ?? AI_PROVIDER_LABELS[type]]),
  ) as Record<AiBackendType, string>;

  return {
    ...pageCopy,
    descriptors,
    providerLabels,
  };
}
