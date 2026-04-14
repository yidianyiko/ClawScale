import type { Locale } from './i18n';

type DashboardCopy = {
  layout: {
    nav: Array<{ href: string; label: string; exact?: boolean }>;
    signOutTitle: string;
    roleLabels: Record<string, string>;
  };
  home: {
    welcomeBack: string;
    welcomeBackTo: string;
    overview: string;
    stats: {
      totalConversations: string;
      totalConversationsSub: string;
      activeChannels: string;
      activeChannelsSub: (count: number) => string;
      endUsers: string;
      endUsersSub: string;
      teamMembers: string;
      teamMembersSub: (count: number) => string;
      aiBackends: string;
      aiBackendsSub: string;
    };
    quickCards: {
      conversations: { title: string; desc: string };
      channels: { title: string; desc: string };
      workflows: { title: string; desc: string };
    };
  };
  login: {
    title: string;
    description: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    submit: string;
    noWorkspacePrompt: string;
    createOne: string;
    genericError: string;
  };
  register: {
    title: string;
    description: string;
    workspaceNameLabel: string;
    workspaceNamePlaceholder: string;
    workspaceUrlLabel: string;
    workspaceUrlPrefix: string;
    workspaceUrlPlaceholder: string;
    workspaceUrlTitle: string;
    yourNameLabel: string;
    yourNamePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    submit: string;
    existingWorkspacePrompt: string;
    signIn: string;
    footer: string;
    genericError: string;
  };
  onboard: {
    missingTenant: string;
    failedToLoadChannels: string;
    loading: string;
    setupError: string;
    unexpectedError: string;
    connectTo: (tenantName: string) => string;
    setupSelectedChannel: (channelLabel: string) => string;
    chooseChannel: string;
    palmosLinked: string;
    channelUnavailable: (channelLabel: string) => string;
    noChannels: string;
    connect: (channelLabel: string) => string;
    contactAdmin: string;
    channelLabels: Record<string, string>;
    channelInstructions: Record<string, string>;
    fallbackInstruction: string;
  };
  conversations: {
    notFound: string;
    confirmDeleteDetail: string;
    confirmDeleteList: string;
    deleteFailed: string;
    anonymous: string;
    back: string;
    blocked: string;
    delete: string;
    title: string;
    subtitle: string;
    empty: string;
    goToChannels: string;
    messages: (count: number) => string;
    deleteTitle: string;
  };
  endUsers: {
    title: string;
    summary: (total: number) => string;
    empty: string;
    emptyHint: string;
    columns: {
      user: string;
      channel: string;
      status: string;
      conversations: string;
      linked: string;
      joined: string;
    };
    statuses: Record<string, string>;
    cokeAccount: (id: string) => string;
    legacyLink: string;
    unbound: string;
    showing: (from: number, to: number, total: number) => string;
    previous: string;
    next: string;
  };
  users: {
    title: string;
    subtitle: string;
    inviteMember: string;
    inviteTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    roleLabel: string;
    roleLabels: Record<string, string>;
    tempPasswordLabel: string;
    tempPasswordPlaceholder: string;
    sendInvite: string;
    cancel: string;
    columns: {
      member: string;
      role: string;
      joined: string;
      lastActive: string;
      actions: string;
    };
    deactivateTitle: string;
    confirmDeactivate: string;
    genericError: string;
  };
  workflows: {
    typeLabels: Record<string, string>;
    title: string;
    subtitle: string;
    newWorkflow: string;
    empty: string;
    createFirst: string;
    genericError: string;
    statuses: {
      active: string;
      inactive: string;
    };
    actions: {
      disable: string;
      enable: string;
    };
    confirmDelete: string;
    modal: {
      title: string;
      name: string;
      description: string;
      descriptionPlaceholder: string;
      type: string;
      scriptCode: string;
      webhookUrl: string;
      appId: string;
      skillName: string;
      cancel: string;
      create: string;
    };
  };
  settings: {
    title: string;
    subtitle: string;
    onlyAdmins: string;
    genericError: string;
    workspace: {
      title: string;
      name: string;
      slug: string;
      slugHint: string;
    };
    persona: {
      title: string;
      subtitle: string;
      name: string;
      namePlaceholder: string;
      prompt: string;
      promptPlaceholder: string;
    };
    assistant: {
      title: string;
      subtitle: string;
      model: string;
      modelPlaceholder: string;
      modelHint: string;
      apiKey: string;
      apiKeyPlaceholder: string;
      apiKeySaved: string;
      enableMultimodal: string;
      multimodalHint: string;
    };
    endUserAccess: {
      title: string;
      subtitle: string;
      anonymous: string;
      anonymousHint: string;
      whitelist: string;
      whitelistHint: string;
      blacklist: string;
      blacklistHint: string;
    };
    saveChanges: string;
    saved: string;
    dangerZone: {
      title: string;
      description: string;
      confirmLabel: string;
      confirmPlaceholder: string;
      confirmValue: string;
      deleteAccount: string;
    };
  };
};

const dashboardMessages: Record<Locale, DashboardCopy> = {
  en: {
    layout: {
      nav: [
        { href: '/dashboard', label: 'Dashboard', exact: true },
        { href: '/dashboard/conversations', label: 'Conversations' },
        { href: '/dashboard/channels', label: 'Channels' },
        { href: '/dashboard/ai-backends', label: 'AI Backends' },
        { href: '/dashboard/workflows', label: 'Workflows' },
        { href: '/dashboard/end-users', label: 'End Users' },
        { href: '/dashboard/users', label: 'Team' },
        { href: '/dashboard/settings', label: 'Settings' },
      ],
      signOutTitle: 'Sign out',
      roleLabels: {
        admin: 'Admin',
        member: 'Member',
        viewer: 'Viewer',
      },
    },
    home: {
      welcomeBack: 'Welcome back',
      welcomeBackTo: 'Welcome back to',
      overview: "Here's an overview of your chatbot.",
      stats: {
        totalConversations: 'Total conversations',
        totalConversationsSub: 'across all channels',
        activeChannels: 'Active channels',
        activeChannelsSub: (count) => `${count} configured`,
        endUsers: 'End users',
        endUsersSub: 'registered',
        teamMembers: 'Team members',
        teamMembersSub: (count) => `${count} active`,
        aiBackends: 'AI backends',
        aiBackendsSub: 'configured',
      },
      quickCards: {
        conversations: {
          title: 'Conversations',
          desc: 'View all conversations end-users are having with your bot.',
        },
        channels: {
          title: 'Channels',
          desc: 'Connect WhatsApp, Telegram, Slack, and more to your bot.',
        },
        workflows: {
          title: 'Workflows',
          desc: 'Define scripts and API integrations the bot can invoke.',
        },
      },
    },
    login: {
      title: 'Sign in',
      description: 'Welcome back to your workspace.',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      passwordLabel: 'Password',
      passwordPlaceholder: '••••••••',
      submit: 'Sign in',
      noWorkspacePrompt: 'No workspace yet?',
      createOne: 'Create one free',
      genericError: 'Unable to sign in right now.',
    },
    register: {
      title: 'Create your workspace',
      description: 'Get your team on ClawScale in minutes.',
      workspaceNameLabel: 'Workspace name',
      workspaceNamePlaceholder: 'Acme Corp',
      workspaceUrlLabel: 'Workspace URL',
      workspaceUrlPrefix: 'clawscale.org/',
      workspaceUrlPlaceholder: 'acme-corp',
      workspaceUrlTitle: 'Lowercase letters, numbers, and hyphens only',
      yourNameLabel: 'Your name',
      yourNamePlaceholder: 'Jane Smith',
      emailLabel: 'Email',
      emailPlaceholder: 'jane@acme.com',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Min. 8 characters',
      submit: 'Create workspace',
      existingWorkspacePrompt: 'Already have a workspace?',
      signIn: 'Sign in',
      footer: 'Free forever for up to 5 users. No credit card required.',
      genericError: 'Unable to create your workspace right now.',
    },
    onboard: {
      missingTenant: 'Missing tenant parameter',
      failedToLoadChannels: 'Failed to load channels',
      loading: 'Loading...',
      setupError: 'Setup Error',
      unexpectedError: 'Something went wrong',
      connectTo: (tenantName) => `Connect to ${tenantName}`,
      setupSelectedChannel: (channelLabel) => `Set up ${channelLabel} to start chatting.`,
      chooseChannel: 'Choose a channel to start chatting with your AI assistant.',
      palmosLinked: 'Palmos account linked',
      channelUnavailable: (channelLabel) => `${channelLabel} is not available yet. Ask your admin to set it up.`,
      noChannels: 'No channels are available yet.',
      connect: (channelLabel) => `Connect ${channelLabel}`,
      contactAdmin: 'Contact your admin for connection details.',
      fallbackInstruction: 'Follow the link below to connect.',
      channelLabels: {
        discord: 'Discord',
        whatsapp: 'WhatsApp',
        whatsapp_business: 'WhatsApp Business',
        telegram: 'Telegram',
        slack: 'Slack',
        line: 'LINE',
        signal: 'Signal',
        teams: 'Microsoft Teams',
        matrix: 'Matrix',
        web: 'Web Chat',
      },
      channelInstructions: {
        discord: 'Click the link below to add the bot to your Discord server, then send it a message.',
        whatsapp: 'Scan the QR code or message the number below to start chatting.',
        whatsapp_business: 'Click the link below to start a WhatsApp conversation.',
        telegram: 'Click the link below to open a chat with the bot in Telegram.',
        slack: 'Click the link below to install the app in your Slack workspace.',
        line: 'Add the bot as a friend using the link below.',
        signal: 'Message the number below on Signal to start chatting.',
        teams: 'Click the link below to add the bot to Microsoft Teams.',
        matrix: 'Join the room using the link below.',
        web: 'Click the link below to start chatting in your browser.',
      },
    },
    conversations: {
      notFound: 'Conversation not found.',
      confirmDeleteDetail: 'Delete this conversation and all its messages? This cannot be undone.',
      confirmDeleteList: 'Delete this conversation and all its messages?',
      deleteFailed: 'Failed to delete conversation.',
      anonymous: 'Anonymous',
      back: 'Back',
      blocked: 'Blocked',
      delete: 'Delete',
      title: 'Conversations',
      subtitle: 'All conversations end-users are having with your bot.',
      empty: 'No conversations yet. Connect a channel to get started.',
      goToChannels: 'Go to Channels',
      messages: (count) => `${count} messages`,
      deleteTitle: 'Delete conversation',
    },
    endUsers: {
      title: 'End Users',
      summary: (total) => `${total} registered user${total !== 1 ? 's' : ''} across all channels.`,
      empty: 'No end users yet.',
      emptyHint: 'Users will appear here once they message your bot.',
      columns: {
        user: 'User',
        channel: 'Channel',
        status: 'Status',
        conversations: 'Conversations',
        linked: 'Linked',
        joined: 'Joined',
      },
      statuses: {
        allowed: 'Allowed',
        blocked: 'Blocked',
      },
      cokeAccount: (id) => `Coke account ${id}`,
      legacyLink: 'Legacy link only',
      unbound: 'Unbound',
      showing: (from, to, total) => `Showing ${from}-${to} of ${total}`,
      previous: 'Previous',
      next: 'Next',
    },
    users: {
      title: 'Team',
      subtitle: 'Manage members and their access.',
      inviteMember: 'Invite member',
      inviteTitle: 'Invite a team member',
      nameLabel: 'Name',
      namePlaceholder: 'Jane Smith',
      emailLabel: 'Email',
      emailPlaceholder: 'jane@acme.com',
      roleLabel: 'Role',
      roleLabels: {
        admin: 'Admin',
        member: 'Member',
        viewer: 'Viewer',
      },
      tempPasswordLabel: 'Temporary password',
      tempPasswordPlaceholder: 'Min. 8 characters',
      sendInvite: 'Send invite',
      cancel: 'Cancel',
      columns: {
        member: 'Member',
        role: 'Role',
        joined: 'Joined',
        lastActive: 'Last active',
        actions: 'Actions',
      },
      deactivateTitle: 'Deactivate',
      confirmDeactivate: 'Deactivate this user? They will lose access immediately.',
      genericError: 'Unable to update the team right now.',
    },
    workflows: {
      typeLabels: {
        script_js: 'JavaScript',
        script_python: 'Python',
        script_shell: 'Shell',
        n8n: 'n8n',
        pulse_editor: 'Pulse Editor',
      },
      title: 'Workflows',
      subtitle: 'Automations the AI agent can invoke during conversations.',
      newWorkflow: 'New workflow',
      empty: "No workflows yet. Create one to extend your bot's capabilities.",
      createFirst: 'New workflow',
      genericError: 'Unable to update workflows right now.',
      statuses: {
        active: 'Active',
        inactive: 'Inactive',
      },
      actions: {
        disable: 'Disable',
        enable: 'Enable',
      },
      confirmDelete: 'Delete this workflow?',
      modal: {
        title: 'New Workflow',
        name: 'Name',
        description: 'Description',
        descriptionPlaceholder: 'Optional - helps the AI decide when to use this',
        type: 'Type',
        scriptCode: 'Script code',
        webhookUrl: 'Webhook URL',
        appId: 'App ID',
        skillName: 'Skill name',
        cancel: 'Cancel',
        create: 'Create',
      },
    },
    settings: {
      title: 'Settings',
      subtitle: 'Configure your workspace and AI persona.',
      onlyAdmins: 'Only admins can edit workspace settings.',
      genericError: 'Unable to save your settings right now.',
      workspace: {
        title: 'Workspace',
        name: 'Workspace name',
        slug: 'Workspace slug',
        slugHint: 'Slug cannot be changed after creation.',
      },
      persona: {
        title: 'AI Persona',
        subtitle: 'How the bot presents itself to end-users.',
        name: 'Persona name',
        namePlaceholder: 'Assistant',
        prompt: 'System prompt',
        promptPlaceholder: 'You are a helpful assistant for Acme Corp...',
      },
      assistant: {
        title: 'ClawScale Assistant',
        subtitle: 'Configure the built-in AI assistant that helps end-users navigate your bot.',
        model: 'Model',
        modelPlaceholder: 'openai:gpt-5.4-mini',
        modelHint: 'LangChain format, for example "openai:gpt-5.4-mini" or "anthropic:claude-haiku-4-5-20251001".',
        apiKey: 'API key',
        apiKeyPlaceholder: 'sk-...',
        apiKeySaved: 'API key is saved. Enter a new value to replace it.',
        enableMultimodal: 'Enable multimodal input',
        multimodalHint: 'Allow the assistant to process images, files, and audio sent by users. Requires a vision-capable model.',
      },
      endUserAccess: {
        title: 'End-User Access',
        subtitle: 'Control who can interact with your bot.',
        anonymous: 'Anonymous',
        anonymousHint: 'Anyone who messages the bot can use it.',
        whitelist: 'Whitelist',
        whitelistHint: 'Only users on the allow-list can interact.',
        blacklist: 'Blacklist',
        blacklistHint: 'Everyone except users on the block-list can interact.',
      },
      saveChanges: 'Save changes',
      saved: 'Saved!',
      dangerZone: {
        title: 'Danger Zone',
        description: 'Permanently delete your account. This removes your member profile and logs you out. This action cannot be undone.',
        confirmLabel: 'Type "delete my account" to confirm',
        confirmPlaceholder: 'delete my account',
        confirmValue: 'delete my account',
        deleteAccount: 'Delete my account',
      },
    },
  },
  zh: {
    layout: {
      nav: [
        { href: '/dashboard', label: '总览', exact: true },
        { href: '/dashboard/conversations', label: '对话' },
        { href: '/dashboard/channels', label: '渠道' },
        { href: '/dashboard/ai-backends', label: 'AI 后端' },
        { href: '/dashboard/workflows', label: '工作流' },
        { href: '/dashboard/end-users', label: '终端用户' },
        { href: '/dashboard/users', label: '团队' },
        { href: '/dashboard/settings', label: '设置' },
      ],
      signOutTitle: '退出登录',
      roleLabels: {
        admin: '管理员',
        member: '成员',
        viewer: '只读成员',
      },
    },
    home: {
      welcomeBack: '欢迎回来',
      welcomeBackTo: '欢迎回到',
      overview: '这里是你的聊天机器人工作区概览。',
      stats: {
        totalConversations: '总对话数',
        totalConversationsSub: '覆盖全部渠道',
        activeChannels: '活跃渠道',
        activeChannelsSub: (count) => `已配置 ${count} 个`,
        endUsers: '终端用户',
        endUsersSub: '已注册',
        teamMembers: '团队成员',
        teamMembersSub: (count) => `${count} 人活跃`,
        aiBackends: 'AI 后端',
        aiBackendsSub: '已配置',
      },
      quickCards: {
        conversations: {
          title: '对话',
          desc: '查看终端用户正在与你的机器人进行的全部对话。',
        },
        channels: {
          title: '渠道',
          desc: '把 WhatsApp、Telegram、Slack 等接入你的机器人。',
        },
        workflows: {
          title: '工作流',
          desc: '定义机器人可调用的脚本与 API 集成。',
        },
      },
    },
    login: {
      title: '登录',
      description: '欢迎回到你的工作区。',
      emailLabel: '邮箱',
      emailPlaceholder: 'you@example.com',
      passwordLabel: '密码',
      passwordPlaceholder: '••••••••',
      submit: '登录',
      noWorkspacePrompt: '还没有工作区？',
      createOne: '免费创建',
      genericError: '暂时无法登录，请稍后再试。',
    },
    register: {
      title: '创建你的工作区',
      description: '几分钟内即可让团队开始使用 ClawScale。',
      workspaceNameLabel: '工作区名称',
      workspaceNamePlaceholder: 'Acme Corp',
      workspaceUrlLabel: '工作区地址',
      workspaceUrlPrefix: 'clawscale.org/',
      workspaceUrlPlaceholder: 'acme-corp',
      workspaceUrlTitle: '只允许小写字母、数字和连字符',
      yourNameLabel: '你的名字',
      yourNamePlaceholder: 'Jane Smith',
      emailLabel: '邮箱',
      emailPlaceholder: 'jane@acme.com',
      passwordLabel: '密码',
      passwordPlaceholder: '至少 8 个字符',
      submit: '创建工作区',
      existingWorkspacePrompt: '已经有工作区？',
      signIn: '去登录',
      footer: '最多 5 个用户永久免费，无需信用卡。',
      genericError: '暂时无法创建工作区，请稍后再试。',
    },
    onboard: {
      missingTenant: '缺少 tenant 参数',
      failedToLoadChannels: '加载渠道失败',
      loading: '加载中...',
      setupError: '设置错误',
      unexpectedError: '发生了未知错误',
      connectTo: (tenantName) => `连接到 ${tenantName}`,
      setupSelectedChannel: (channelLabel) => `设置 ${channelLabel}，开始与你的 AI 助手对话。`,
      chooseChannel: '选择一个渠道，开始与你的 AI 助手对话。',
      palmosLinked: '已关联 Palmos 账号',
      channelUnavailable: (channelLabel) => `${channelLabel} 暂时不可用，请联系管理员完成设置。`,
      noChannels: '当前还没有可用渠道。',
      connect: (channelLabel) => `连接 ${channelLabel}`,
      contactAdmin: '请联系管理员获取连接信息。',
      fallbackInstruction: '请根据下方链接完成连接。',
      channelLabels: {
        discord: 'Discord',
        whatsapp: 'WhatsApp',
        whatsapp_business: 'WhatsApp Business',
        telegram: 'Telegram',
        slack: 'Slack',
        line: 'LINE',
        signal: 'Signal',
        teams: 'Microsoft Teams',
        matrix: 'Matrix',
        web: '网页聊天',
      },
      channelInstructions: {
        discord: '点击下方链接把机器人添加到你的 Discord 服务器，然后给它发送一条消息。',
        whatsapp: '扫描二维码，或给下方号码发送消息开始聊天。',
        whatsapp_business: '点击下方链接开始一段 WhatsApp 对话。',
        telegram: '点击下方链接，在 Telegram 中打开与机器人的聊天。',
        slack: '点击下方链接，把应用安装到你的 Slack 工作区。',
        line: '通过下方链接把机器人加为好友。',
        signal: '在 Signal 中给下方号码发消息开始聊天。',
        teams: '点击下方链接，把机器人添加到 Microsoft Teams。',
        matrix: '通过下方链接加入房间。',
        web: '点击下方链接，在浏览器中开始聊天。',
      },
    },
    conversations: {
      notFound: '未找到该对话。',
      confirmDeleteDetail: '删除这个对话及其全部消息？此操作无法撤销。',
      confirmDeleteList: '删除这个对话及其全部消息？',
      deleteFailed: '删除对话失败。',
      anonymous: '匿名用户',
      back: '返回',
      blocked: '已封禁',
      delete: '删除',
      title: '对话',
      subtitle: '终端用户正在与你的机器人进行的全部对话。',
      empty: '还没有对话。先连接一个渠道开始使用。',
      goToChannels: '前往渠道',
      messages: (count) => `${count} 条消息`,
      deleteTitle: '删除对话',
    },
    endUsers: {
      title: '终端用户',
      summary: (total) => `全部渠道共 ${total} 位已注册用户。`,
      empty: '还没有终端用户。',
      emptyHint: '当用户开始给你的机器人发消息后，会显示在这里。',
      columns: {
        user: '用户',
        channel: '渠道',
        status: '状态',
        conversations: '对话数',
        linked: '关联',
        joined: '加入时间',
      },
      statuses: {
        allowed: '允许',
        blocked: '封禁',
      },
      cokeAccount: (id) => `Coke 账号 ${id}`,
      legacyLink: '仅保留旧关联',
      unbound: '未绑定',
      showing: (from, to, total) => `显示 ${from}-${to} / ${total}`,
      previous: '上一页',
      next: '下一页',
    },
    users: {
      title: '团队',
      subtitle: '管理成员及其访问权限。',
      inviteMember: '邀请成员',
      inviteTitle: '邀请团队成员',
      nameLabel: '姓名',
      namePlaceholder: 'Jane Smith',
      emailLabel: '邮箱',
      emailPlaceholder: 'jane@acme.com',
      roleLabel: '角色',
      roleLabels: {
        admin: '管理员',
        member: '成员',
        viewer: '只读成员',
      },
      tempPasswordLabel: '临时密码',
      tempPasswordPlaceholder: '至少 8 个字符',
      sendInvite: '发送邀请',
      cancel: '取消',
      columns: {
        member: '成员',
        role: '角色',
        joined: '加入时间',
        lastActive: '最近活跃',
        actions: '操作',
      },
      deactivateTitle: '停用',
      confirmDeactivate: '停用该用户？停用后会立即失去访问权限。',
      genericError: '暂时无法更新团队成员，请稍后再试。',
    },
    workflows: {
      typeLabels: {
        script_js: 'JavaScript',
        script_python: 'Python',
        script_shell: 'Shell',
        n8n: 'n8n',
        pulse_editor: 'Pulse Editor',
      },
      title: '工作流',
      subtitle: 'AI 代理在对话中可以调用的自动化能力。',
      newWorkflow: '新建工作流',
      empty: '还没有工作流。创建一个来扩展机器人的能力。',
      createFirst: '新建工作流',
      genericError: '暂时无法更新工作流，请稍后再试。',
      statuses: {
        active: '启用',
        inactive: '停用',
      },
      actions: {
        disable: '停用',
        enable: '启用',
      },
      confirmDelete: '删除这个工作流？',
      modal: {
        title: '新建工作流',
        name: '名称',
        description: '描述',
        descriptionPlaceholder: '可选，用来帮助 AI 判断何时使用它',
        type: '类型',
        scriptCode: '脚本代码',
        webhookUrl: 'Webhook 地址',
        appId: 'App ID',
        skillName: 'Skill 名称',
        cancel: '取消',
        create: '创建',
      },
    },
    settings: {
      title: '设置',
      subtitle: '配置你的工作区与 AI 角色。',
      onlyAdmins: '只有管理员可以编辑工作区设置。',
      genericError: '暂时无法保存设置，请稍后再试。',
      workspace: {
        title: '工作区',
        name: '工作区名称',
        slug: '工作区 slug',
        slugHint: '工作区创建后无法修改 slug。',
      },
      persona: {
        title: 'AI 角色',
        subtitle: '定义机器人在终端用户面前呈现的方式。',
        name: '角色名称',
        namePlaceholder: 'Assistant',
        prompt: '系统提示词',
        promptPlaceholder: 'You are a helpful assistant for Acme Corp...',
      },
      assistant: {
        title: 'ClawScale Assistant',
        subtitle: '配置内置 AI 助手，帮助终端用户理解和使用你的机器人。',
        model: '模型',
        modelPlaceholder: 'openai:gpt-5.4-mini',
        modelHint: 'LangChain 格式，例如 “openai:gpt-5.4-mini” 或 “anthropic:claude-haiku-4-5-20251001”。',
        apiKey: 'API Key',
        apiKeyPlaceholder: 'sk-...',
        apiKeySaved: 'API Key 已保存。输入新值即可替换。',
        enableMultimodal: '启用多模态输入',
        multimodalHint: '允许助手处理图片、文件和音频。需要支持视觉能力的模型。',
      },
      endUserAccess: {
        title: '终端用户访问',
        subtitle: '控制谁可以与你的机器人交互。',
        anonymous: '匿名开放',
        anonymousHint: '任何给机器人发消息的人都可以使用。',
        whitelist: '白名单',
        whitelistHint: '只有允许名单内的用户可以交互。',
        blacklist: '黑名单',
        blacklistHint: '除封禁名单外的所有人都可以交互。',
      },
      saveChanges: '保存更改',
      saved: '已保存！',
      dangerZone: {
        title: '危险区域',
        description: '永久删除你的账号。这会移除成员资料并将你登出，此操作无法撤销。',
        confirmLabel: '输入 “delete my account” 以确认',
        confirmPlaceholder: 'delete my account',
        confirmValue: 'delete my account',
        deleteAccount: '删除我的账号',
      },
    },
  },
};

export function getDashboardCopy(locale: Locale) {
  return dashboardMessages[locale];
}
