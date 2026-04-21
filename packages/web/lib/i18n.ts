export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'coke-locale';
export const LOCALE_COOKIE_NAME = 'coke-locale';
export const LOCALE_BOOTSTRAP_KEY = '__COKE_LOCALE__';

type SharedButtonMessages = {
  signIn: string;
  register: string;
};

type BindWechatViewModelMessages = {
  missing: {
    eyebrow: string;
    title: string;
    description: string;
    primaryActionLabel: string;
  };
  disconnected: {
    eyebrow: string;
    title: string;
    description: string;
    primaryActionLabel: string;
  };
  pending: {
    eyebrow: string;
    title: string;
    description: string;
    primaryActionLabel: string;
  };
  connected: {
    eyebrow: string;
    title: string;
    descriptionWithIdentity: string;
    descriptionWithoutIdentity: string;
    primaryActionLabel: string;
  };
  error: {
    eyebrow: string;
    title: string;
    descriptionFallback: string;
    primaryActionLabel: string;
    secondaryActionLabel: string;
  };
  archived: {
    eyebrow: string;
    title: string;
    description: string;
    primaryActionLabel: string;
  };
};

type CustomerLayoutMessages = {
  brandName: string;
  brandTagline: string;
  navLabel: string;
  eyebrow: string;
  title: string;
  body: string;
  secondaryBody: string;
  trustLines: string[];
};

type CokeUserLayoutMessages = CustomerLayoutMessages;

type CustomerPagesMessages = {
  login: {
    eyebrow: string;
    heroTitle: string;
    heroBody: string;
    heroSecondaryBody: string;
    backToHomepage: string;
    title: string;
    description: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    submit: string;
    submitting: string;
    forgotPasswordPrompt: string;
    forgotPasswordLink: string;
    registerPrompt: string;
    registerLink: string;
    suspendedError: string;
    emailVerificationRequired: string;
    subscriptionRenewalRequired: string;
    success: string;
    genericError: string;
    verificationRecoveryTitle: string;
    verificationRecoveryDescription: string;
    verificationRetryDescription: string;
    resendVerificationEmail: string;
    resendingVerificationEmail: string;
    resendVerificationSuccess: string;
    resendVerificationError: string;
  };
  register: {
    eyebrow: string;
    heroTitle: string;
    heroBody: string;
    heroSecondaryBody: string;
    backToHomepage: string;
    title: string;
    description: string;
    displayNameLabel: string;
    displayNamePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    submit: string;
    submitting: string;
    signInPrompt: string;
    signInLink: string;
    genericError: string;
  };
  forgotPassword: {
    title: string;
    description: string;
    emailLabel: string;
    emailPlaceholder: string;
    submit: string;
    submitting: string;
    success: string;
    backToSignInPrompt: string;
    backToSignInLink: string;
    genericError: string;
  };
  resetPassword: {
    title: string;
    description: string;
    tokenLabel: string;
    tokenPlaceholder: string;
    passwordLabel: string;
    confirmPasswordLabel: string;
    submit: string;
    submitting: string;
    mismatchError: string;
    success: string;
    requestNewLinkPrompt: string;
    requestNewLinkLink: string;
    genericError: string;
  };
  verifyEmail: {
    title: string;
    description: string;
    verifyingDescription: string;
  };
  claim: {
    eyebrow: string;
    title: string;
    description: string;
    tokenLabel: string;
    tokenPlaceholder: string;
    passwordLabel: string;
    confirmPasswordLabel: string;
    submit: string;
    submitting: string;
    mismatchError: string;
    invalidOrExpiredError: string;
    emailAlreadyExistsError: string;
    genericError: string;
    signInPrompt: string;
    signInLink: string;
  };
  channelsIndex: {
    eyebrow: string;
    title: string;
    description: string;
    wechatPersonalTitle: string;
    wechatPersonalDescription: string;
  };
  bindWechat: {
    blocked: {
      accessEyebrow: string;
      suspendedTitle: string;
      suspendedDescription: string;
      prerequisitesTitle: string;
      prerequisitesDescription: string;
      verifyEmail: string;
      renewSubscription: string;
    };
    loadFailure: {
      title: string;
    };
    loading: {
      title: string;
      description: string;
    };
    statusDescriptions: {
      missing: string;
      archived: string;
      disconnected: string;
    };
    qr: {
      imageAlt: string;
      preparing: string;
      expiresPrefix: string;
      activeSuffix: string;
    };
    connectedCard: {
      eyebrow: string;
      descriptionWithIdentity: string;
      descriptionWithoutIdentity: string;
      accountOwnershipSuffix: string;
    };
    errorCard: {
      eyebrow: string;
      fallbackDescription: string;
    };
    nextSteps: {
      title: string;
      missing: string;
      disconnected: string;
      pending: string;
      connected: string;
      error: string;
      archived: string;
    };
    busyActions: {
      create: string;
      connect: string;
      refresh: string;
      disconnect: string;
      reconnect: string;
      archive: string;
    };
    accountPrompt: string;
    createAccount: string;
    viewModel: BindWechatViewModelMessages;
  };
};

type CokeUserPagesMessages = {
  renew: {
    title: string;
    preparing: string;
    ready: string;
    signIn: string;
    backToSetup: string;
    genericError: string;
  };
  paymentSuccess: {
    title: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
  };
  paymentCancel: {
    title: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
  };
};

export type LocaleMessages = {
  common: {
    languageLabel: string;
    localeLabel: string;
    retryLabel: string;
    signOutLabel: string;
  };
  publicShell: {
    brandTagline: string;
    nav: Array<{ href: string; label: string }>;
    cta: SharedButtonMessages;
    languageSwitchLabel: string;
  };
  homepage: {
    hero: {
      eyebrow: string;
      title: string;
      subtitle: string;
      titleLine1: string;
      titleItalicMiddle: string;
      titleLine3: string;
      body: string;
      primaryCta: string;
      secondaryCta: string;
      foot: string;
    };
    stats: Array<{ value: string; label: string }>;
    spotlight: {
      title: string;
      body: string;
    };
    platforms: {
      eyebrow: string;
      title: string;
      subtitle: string;
      items: string[];
    };
    features: {
      eyebrow: string;
      title: string;
      subtitle: string;
      items: Array<{
        title: string;
        subtitle: string;
        body: string;
      }>;
    };
    architecture: {
      eyebrow: string;
      title: string;
      subtitle: string;
      points: string[];
    };
    contact: {
      eyebrow: string;
      title: string;
      body: string;
      primaryCta: string;
      secondaryCta: string;
      placeholder: string;
      note: string;
      thanks: string;
    };
    footer: {
      productHeading: string;
      accountHeading: string;
      companyHeading: string;
      copyright: string;
      tagline: string;
      productLinks: string[];
      accountLinks: string[];
      companyLinks: string[];
    };
  };
  customerLayout: CustomerLayoutMessages;
  cokeUserLayout: CokeUserLayoutMessages;
  customerPages: CustomerPagesMessages;
  cokeUserPages: CokeUserPagesMessages;
};

export type MessagesCatalog = Record<Locale, LocaleMessages>;

export const messages: MessagesCatalog = {
  en: {
    common: {
      languageLabel: 'Language',
      localeLabel: 'Locale',
      retryLabel: 'Retry',
      signOutLabel: 'Sign out',
    },
    publicShell: {
      brandTagline: 'An AI Partner That Grows With You',
      nav: [
        { href: '/#platforms', label: 'Platforms' },
        { href: '/#features', label: 'Features' },
        { href: '/#architecture', label: 'Architecture' },
        { href: '/#contact', label: 'Contact' },
      ],
      cta: {
        signIn: 'Sign in',
        register: 'Register',
      },
      languageSwitchLabel: 'Switch language',
    },
    homepage: {
      hero: {
        eyebrow: 'Evolves With You',
        title: 'Your AI assistant that grows with you',
        subtitle: 'An AI Partner That Grows With You',
        titleLine1: 'An AI partner',
        titleItalicMiddle: 'that grows',
        titleLine3: 'with you.',
        body: 'Coke AI is more than a tool. It becomes a sharper partner as it learns your rhythm, priorities, and context over time.',
        primaryCta: 'Register',
        secondaryCta: 'Sign in',
        foot: 'Six platforms · 99.9% uptime · <100ms latency',
      },
      stats: [
        { value: '6+', label: 'Platforms' },
        { value: '99.9%', label: 'Uptime' },
        { value: '<100ms', label: 'Latency' },
        { value: '24/7', label: 'Always on' },
      ],
      spotlight: {
        title: 'One assistant, all platforms',
        body: 'No context switching. Coke AI meets you inside the channels you already rely on.',
      },
      platforms: {
        eyebrow: 'Platforms',
        title: 'Seamlessly integrated across major IM platforms',
        subtitle:
          'Coke AI fits into the channels you already use instead of asking you to learn a new one.',
        items: ['WeChat', 'Telegram', 'DingTalk', 'Lark', 'Slack', 'Discord'],
      },
      features: {
        eyebrow: 'Features',
        title: 'Powerful assistance for modern work and life',
        subtitle:
          'From planning to proactive follow-through, Coke AI stays involved instead of answering once and disappearing.',
        items: [
          {
            title: 'Scheduling',
            subtitle: 'Planning',
            body: 'Understands context and helps you arrange meetings, reminders, and day-to-day follow-ups.',
          },
          {
            title: 'Task planning',
            subtitle: 'Roadmaps',
            body: 'Breaks complex goals into clearer action paths that adapt to the way you actually work.',
          },
          {
            title: 'Data analysis',
            subtitle: 'Insights',
            body: 'Finds patterns in your rhythm and behavior, then turns them into practical next steps.',
          },
          {
            title: 'Proactive workflows',
            subtitle: 'Automation',
            body: 'Steps in at the right moment to remind, nudge, and move work forward without constant prompting.',
          },
        ],
      },
      architecture: {
        eyebrow: 'Architecture',
        title: 'Built on a reliable technical foundation',
        subtitle:
          'The public experience and the long-running product both depend on a stable core, not just a polished landing page.',
        points: [
          'Modular architecture',
          'AI-driven orchestration',
          'Reliable data persistence',
          'Privacy-first operation',
        ],
      },
      contact: {
        eyebrow: 'Beta',
        title: 'Ready to experience the future of AI assistance?',
        body: 'Join our beta program, create an account, verify your email, and continue into your personal WeChat binding flow.',
        primaryCta: 'Join beta',
        secondaryCta: 'Existing account',
        placeholder: 'your email',
        note: "We won't share your email with anyone else.",
        thanks: "Thanks. We'll be in touch within 24 hours.",
      },
      footer: {
        productHeading: 'Product',
        accountHeading: 'Account',
        companyHeading: 'Company',
        copyright: '© 2026 Coke AI',
        tagline: 'Built to grow with you.',
        productLinks: ['Platforms', 'Features', 'Architecture'],
        accountLinks: ['Sign in', 'Register', 'Renew'],
        companyLinks: ['About', 'Contact', 'Privacy'],
      },
    },
    customerLayout: {
      brandName: 'Coke AI',
      brandTagline: 'Unified customer auth and channel access',
      navLabel: 'Handle sign-in, verification, and personal WeChat access',
      eyebrow: 'Customer Account',
      title: 'Enter your customer workspace',
      body: 'Use the neutral customer routes for sign-in, registration, password recovery, email verification, and personal WeChat setup.',
      secondaryBody: 'Legacy /coke/* generic routes stay in place as compatibility redirects until every internal caller moves.',
      trustLines: [
        'End-to-end encrypted transport',
        'Sign-in and channel access stay on one path',
        'Designed for customer and personal setup',
      ],
    },
    cokeUserLayout: {
      brandName: 'Coke AI',
      brandTagline: 'Subscription and Coke business management',
      navLabel: 'Manage Coke billing and delivery state',
      eyebrow: 'Coke Workspace',
      title: 'Keep your Coke service active',
      body: 'Handle renewal, payment follow-up, and the business-side steps that still stay under Coke-specific routes.',
      secondaryBody: 'Generic sign-in, recovery, and customer channel setup now live under the neutral customer routes.',
    },
    customerPages: {
      login: {
        eyebrow: 'Sign in',
        heroTitle: 'Return to your Coke account',
        heroBody:
          'After sign-in, Coke keeps the existing verification and subscription checks, then routes you back to your personal WeChat setup.',
        heroSecondaryBody:
          'Use the same account flow you started from the public homepage.',
        backToHomepage: 'Back to homepage',
        title: 'Sign in to Coke',
        description: 'Enter your email and password to continue your personal Coke flow.',
        emailLabel: 'Email',
        emailPlaceholder: 'alice@example.com',
        passwordLabel: 'Password',
        passwordPlaceholder: 'Enter your password',
        submit: 'Sign in to Coke',
        submitting: 'Signing in...',
        forgotPasswordPrompt: 'Forgot your password?',
        forgotPasswordLink: 'Reset it',
        registerPrompt: 'Need an account?',
        registerLink: 'Create one',
        suspendedError: 'Your Coke account is suspended.',
        emailVerificationRequired: 'Email verification is required.',
        subscriptionRenewalRequired: 'Subscription renewal is required.',
        success: 'Sign-in succeeded.',
        genericError: 'Unable to sign in right now.',
        verificationRecoveryTitle: 'Verify your email',
        verificationRecoveryDescription:
          'This link is invalid or expired. Resend a verification email to continue.',
        verificationRetryDescription:
          "We couldn't verify your email right now. Resend a verification email to continue.",
        resendVerificationEmail: 'Resend verification email',
        resendingVerificationEmail: 'Sending verification email...',
        resendVerificationSuccess: 'Verification email sent. Check your inbox.',
        resendVerificationError: 'Unable to resend the verification email right now.',
      },
      register: {
        eyebrow: 'Register',
        heroTitle: 'Create your Coke account',
        heroBody:
          'Registration leads into email verification first, then the personal WeChat channel setup you already use.',
        heroSecondaryBody: 'Create your account once and continue the rest of the setup from here.',
        backToHomepage: 'Back to homepage',
        title: 'Create your Coke account',
        description: 'Register here, verify your email, and continue into personal channel setup.',
        displayNameLabel: 'Display name',
        displayNamePlaceholder: 'Alice',
        emailLabel: 'Email',
        emailPlaceholder: 'alice@example.com',
        passwordLabel: 'Password',
        passwordPlaceholder: 'Create a password',
        submit: 'Create Coke account',
        submitting: 'Creating account...',
        signInPrompt: 'Already registered?',
        signInLink: 'Sign in',
        genericError: 'Unable to create your account right now.',
      },
      forgotPassword: {
        title: 'Forgot your password',
        description:
          'Enter your account email and we will send a reset link if the address is registered.',
        emailLabel: 'Email',
        emailPlaceholder: 'alice@example.com',
        submit: 'Send reset link',
        submitting: 'Sending...',
        success: 'Password reset instructions were sent if the account exists.',
        backToSignInPrompt: 'Remembered your password?',
        backToSignInLink: 'Back to sign in',
        genericError: 'Unable to send password reset instructions right now.',
      },
      resetPassword: {
        title: 'Reset your password',
        description: 'Paste the reset token from your email and choose a new password.',
        tokenLabel: 'Reset token',
        tokenPlaceholder: 'Paste the token from your email',
        passwordLabel: 'New password',
        confirmPasswordLabel: 'Confirm password',
        submit: 'Reset password',
        submitting: 'Saving...',
        mismatchError: 'Passwords do not match.',
        success: 'Password reset complete.',
        requestNewLinkPrompt: 'Need to start over?',
        requestNewLinkLink: 'Request a new reset link',
        genericError: 'Unable to reset your password right now.',
      },
      verifyEmail: {
        title: 'Verify your email',
        description: 'We are preparing your secure email verification.',
        verifyingDescription: 'Verifying your email link now...',
      },
      claim: {
        eyebrow: 'Shared channel access',
        title: 'Claim your customer account',
        description: 'Set a password to activate the account that was pre-provisioned from your first inbound message.',
        tokenLabel: 'Claim token',
        tokenPlaceholder: 'Paste the claim token from your email',
        passwordLabel: 'New password',
        confirmPasswordLabel: 'Confirm password',
        submit: 'Activate account',
        submitting: 'Activating...',
        mismatchError: 'Passwords do not match.',
        invalidOrExpiredError: 'This claim link is invalid or has expired.',
        emailAlreadyExistsError: 'That email address is already in use. Sign in or request a new claim link with a different email.',
        genericError: 'Unable to claim your account right now.',
        signInPrompt: 'Already claimed your account?',
        signInLink: 'Sign in',
      },
      channelsIndex: {
        eyebrow: 'Phase 1 channels',
        title: 'Customer channels',
        description: 'Manage the customer channel surfaces that are available in the neutral ClawScale shell today.',
        wechatPersonalTitle: 'Personal WeChat',
        wechatPersonalDescription: 'Connect, reconnect, or archive your personal WeChat channel.',
      },
      bindWechat: {
        blocked: {
          accessEyebrow: 'Account access',
          suspendedTitle: 'Your Coke account is suspended',
          suspendedDescription:
            'Contact support to restore access before binding a personal WeChat channel.',
          prerequisitesTitle:
            'Verify your email and renew your subscription before creating a WeChat channel.',
          prerequisitesDescription:
            'Finish the required account steps, then come back here to create or reconnect your channel.',
          verifyEmail: 'Verify email',
          renewSubscription: 'Renew subscription',
        },
        loadFailure: {
          title: 'Unable to load your WeChat channel',
        },
        loading: {
          title: 'Loading your WeChat channel',
          description: 'We are checking the personal channel attached to this Coke account.',
        },
        statusDescriptions: {
          missing: 'Create the channel first, then start a QR session for your own WeChat login.',
          archived: 'Archived channels do not route messages. Create a fresh channel to start over.',
          disconnected:
            'The channel exists but is not connected yet. Start a QR session to bring it online.',
        },
        qr: {
          imageAlt: 'Personal Coke WeChat login QR',
          preparing: 'Preparing your QR code...',
          expiresPrefix: 'This QR session expires at',
          activeSuffix: 'The current QR session is still active.',
        },
        connectedCard: {
          eyebrow: 'Connected',
          descriptionWithIdentity: 'WeChat {identity} is connected to this Coke account.',
          descriptionWithoutIdentity: 'Your personal WeChat channel is connected and ready.',
          accountOwnershipSuffix: '{name}, this belongs to your Coke account.',
        },
        errorCard: {
          eyebrow: 'Connection error',
          fallbackDescription: 'The last connect attempt failed. Retry or archive this channel.',
        },
        nextSteps: {
          title: 'What you can do next',
          missing: 'Create your personal WeChat channel for this account.',
          disconnected: 'Start a QR login session to connect the existing channel.',
          pending:
            'Scan the QR code with the WeChat account you want to own this channel.',
          connected: 'Disconnect the channel when you want to take it offline.',
          error: 'Retry the connect flow or archive the broken channel.',
          archived: 'Create a fresh channel if you want to start over.',
        },
        busyActions: {
          create: 'Creating...',
          connect: 'Connecting...',
          refresh: 'Refreshing...',
          disconnect: 'Disconnecting...',
          reconnect: 'Reconnecting...',
          archive: 'Archiving...',
        },
        accountPrompt: 'Need an account?',
        createAccount: 'Create one',
        viewModel: {
          missing: {
            eyebrow: 'No channel yet',
            title: 'Create my WeChat channel',
            description:
              'Create a personal WeChat channel for this Coke account, then connect it with a QR login.',
            primaryActionLabel: 'Create my WeChat channel',
          },
          disconnected: {
            eyebrow: 'Channel created',
            title: 'Connect WeChat',
            description:
              'Your personal WeChat channel exists. Start a QR login session to bring it online.',
            primaryActionLabel: 'Connect WeChat',
          },
          pending: {
            eyebrow: 'QR login in progress',
            title: 'Scan the QR code to connect',
            description: 'Use the QR below to log your personal channel into WeChat.',
            primaryActionLabel: 'Refresh QR',
          },
          connected: {
            eyebrow: 'Connected',
            title: 'WeChat is connected',
            descriptionWithIdentity: 'Your personal channel is live as {identity}.',
            descriptionWithoutIdentity: 'Your personal WeChat channel is connected and ready.',
            primaryActionLabel: 'Disconnect WeChat',
          },
          error: {
            eyebrow: 'Connection error',
            title: 'Reconnect or archive your channel',
            descriptionFallback:
              'The last connect attempt failed. You can retry or archive this channel.',
            primaryActionLabel: 'Reconnect',
            secondaryActionLabel: 'Archive channel',
          },
          archived: {
            eyebrow: 'Archived',
            title: 'This WeChat channel is archived',
            description: 'Create a fresh personal channel if you want to use WeChat again.',
            primaryActionLabel: 'Create my WeChat channel again',
          },
        },
      },
    },
    cokeUserPages: {
      renew: {
        title: 'Renew your access',
        preparing: 'Preparing your renewal checkout...',
        ready: 'Return to checkout when you are ready.',
        signIn: 'Sign in',
        backToSetup: 'Back to setup',
        genericError: 'Unable to start renewal right now.',
      },
      paymentSuccess: {
        title: 'Payment complete',
        description:
          'Your renewal payment was received. Return to your account to finish connecting WeChat.',
        primaryCta: 'Go to WeChat setup',
        secondaryCta: 'Check renewal',
      },
      paymentCancel: {
        title: 'Payment canceled',
        description:
          'The checkout flow was canceled before payment completed. You can try again when you are ready.',
        primaryCta: 'Restart renewal',
        secondaryCta: 'Back to setup',
      },
    },
  },
  zh: {
    common: {
      languageLabel: '语言',
      localeLabel: '区域',
      retryLabel: '重试',
      signOutLabel: '退出登录',
    },
    publicShell: {
      brandTagline: '与您共同成长的 AI 助手',
      nav: [
        { href: '/#platforms', label: '平台' },
        { href: '/#features', label: '功能' },
        { href: '/#architecture', label: '架构' },
        { href: '/#contact', label: '联系' },
      ],
      cta: {
        signIn: '登录',
        register: '注册',
      },
      languageSwitchLabel: '切换语言',
    },
    homepage: {
      hero: {
        eyebrow: '与您共同成长',
        title: '会随着使用不断进化的 AI 助手',
        subtitle: '与您共同成长的 AI 助手',
        titleLine1: '会随着使用',
        titleItalicMiddle: '不断进化的',
        titleLine3: 'AI 助手。',
        body: 'Coke AI 不只是工具，更会在长期使用中逐渐理解你的节奏、优先级和上下文，成为更懂你的智能伙伴。',
        primaryCta: '注册',
        secondaryCta: '登录',
        foot: '六个平台 · 99.9% 可用性 · <100ms 响应',
      },
      stats: [
        { value: '6+', label: '平台' },
        { value: '99.9%', label: '可用性' },
        { value: '<100ms', label: '响应时间' },
        { value: '24/7', label: '全天候' },
      ],
      spotlight: {
        title: '一个助手，全平台覆盖',
        body: '无需在应用之间切换，Coke AI 会出现在你已经在使用的平台里。',
      },
      platforms: {
        eyebrow: '平台',
        title: '自然融入主流即时通讯平台',
        subtitle: 'Coke AI 会进入你已经习惯的沟通渠道，而不是要求你重新学习一个新入口。',
        items: ['WeChat', 'Telegram', 'DingTalk', 'Lark', 'Slack', 'Discord'],
      },
      features: {
        eyebrow: '功能',
        title: '面向现代工作与生活的高效协助',
        subtitle: '从规划到主动推进，Coke AI 会持续参与，而不是只回答一次就离开。',
        items: [
          {
            title: '日程管理',
            subtitle: '规划',
            body: '智能理解上下文，帮助你安排会议、提醒和日常跟进。',
          },
          {
            title: '任务规划',
            subtitle: '路径',
            body: '把复杂目标拆成更清晰的行动路径，并随着使用不断贴近你的习惯。',
          },
          {
            title: '数据分析',
            subtitle: '洞察',
            body: '从你的节奏和行为里总结模式，给出可执行的下一步建议。',
          },
          {
            title: '主动工作流',
            subtitle: '自动化',
            body: '在合适的时间主动提醒、推进事项，而不是等你每次都来询问。',
          },
        ],
      },
      architecture: {
        eyebrow: '架构',
        title: '建立在可靠的技术基础之上',
        subtitle: '公开体验和长期运行都需要稳定的底层，而不只是一个漂亮首页。',
        points: ['模块化架构', '智能编排', '稳定数据持久化', '隐私优先运作'],
      },
      contact: {
        eyebrow: '内测',
        title: '准备好体验 AI 协助的未来了吗？',
        body: '加入我们的内测计划，注册账号、验证邮箱，然后继续进入你的个人微信绑定流程。',
        primaryCta: '加入内测',
        secondaryCta: '已有账号',
        placeholder: '你的邮箱',
        note: '我们不会把你的邮箱分享给第三方。',
        thanks: '谢谢。我们会在 24 小时内联系你。',
      },
      footer: {
        productHeading: '产品',
        accountHeading: '账号',
        companyHeading: '公司',
        copyright: '© 2026 Coke AI',
        tagline: '与你一起慢慢变好。',
        productLinks: ['平台', '功能', '架构'],
        accountLinks: ['登录', '注册', '续费'],
        companyLinks: ['关于', '联系', '隐私'],
      },
    },
    customerLayout: {
      brandName: 'Coke AI',
      brandTagline: '统一管理客户登录与通道接入',
      navLabel: '处理登录、验证与个人微信接入',
      eyebrow: '客户账号',
      title: '进入你的客户工作区',
      body: '在中立的 customer 路由下完成登录、注册、密码找回、邮箱验证和个人微信接入。',
      secondaryBody: '旧的 /coke/* 通用入口会暂时保留为兼容跳转，直到所有内部调用都迁移完成。',
      trustLines: [
        '全程加密传输',
        '登录、验证与接入保持同一路径',
        '为客户与个人通道统一设计',
      ],
    },
    cokeUserLayout: {
      brandName: 'Coke AI',
      brandTagline: '管理订阅与 Coke 业务状态',
      navLabel: '管理 Coke 账单与交付状态',
      eyebrow: 'Coke 工作区',
      title: '保持你的 Coke 服务处于启用状态',
      body: '在这里处理续费、支付后续动作，以及仍然保留在 Coke 专属路由下的业务步骤。',
      secondaryBody: '通用登录、找回访问和客户通道设置现在都放在中立的 customer 路由下。',
    },
    customerPages: {
      login: {
        eyebrow: '登录',
        heroTitle: '返回你的 Coke 账号',
        heroBody: '登录后，系统会继续检查邮箱验证和订阅状态，再把你带回个人微信设置流程。',
        heroSecondaryBody: '使用你在官网入口创建的同一个账号继续后续流程。',
        backToHomepage: '返回首页',
        title: '登录 Coke',
        description: '输入邮箱和密码，继续你的个人 Coke 使用流程。',
        emailLabel: '邮箱',
        emailPlaceholder: 'alice@example.com',
        passwordLabel: '密码',
        passwordPlaceholder: '输入你的密码',
        submit: '登录 Coke',
        submitting: '登录中...',
        forgotPasswordPrompt: '忘记密码？',
        forgotPasswordLink: '立即重置',
        registerPrompt: '还没有账号？',
        registerLink: '创建账号',
        suspendedError: '你的 Coke 账号已被停用。',
        emailVerificationRequired: '需要先完成邮箱验证。',
        subscriptionRenewalRequired: '需要先完成订阅续费。',
        success: '登录成功。',
        genericError: '暂时无法登录，请稍后再试。',
        verificationRecoveryTitle: '验证你的邮箱',
        verificationRecoveryDescription: '这个链接已失效或已过期。请重新发送验证邮件继续。',
        verificationRetryDescription: '暂时无法验证你的邮箱。请重新发送验证邮件继续。',
        resendVerificationEmail: '重新发送验证邮件',
        resendingVerificationEmail: '正在发送验证邮件...',
        resendVerificationSuccess: '验证邮件已发送，请查收邮箱。',
        resendVerificationError: '暂时无法重新发送验证邮件，请稍后再试。',
      },
      register: {
        eyebrow: '注册',
        heroTitle: '创建你的 Coke 账号',
        heroBody: '注册完成后会先进入邮箱验证，然后继续进入你已经在使用的个人微信设置流程。',
        heroSecondaryBody: '先完成账号创建，再从这里继续后续步骤。',
        backToHomepage: '返回首页',
        title: '创建你的 Coke 账号',
        description: '在这里注册账号、完成邮箱验证，然后继续进入个人通道设置。',
        displayNameLabel: '昵称',
        displayNamePlaceholder: '例如：小可',
        emailLabel: '邮箱',
        emailPlaceholder: 'alice@example.com',
        passwordLabel: '密码',
        passwordPlaceholder: '创建一个密码',
        submit: '创建 Coke 账号',
        submitting: '账号创建中...',
        signInPrompt: '已经注册？',
        signInLink: '去登录',
        genericError: '暂时无法创建账号，请稍后再试。',
      },
      forgotPassword: {
        title: '忘记密码',
        description: '输入账号邮箱，如果该地址已注册，我们会发送重置链接。',
        emailLabel: '邮箱',
        emailPlaceholder: 'alice@example.com',
        submit: '发送重置链接',
        submitting: '发送中...',
        success: '如果该账号存在，我们已经发送了密码重置说明。',
        backToSignInPrompt: '想起密码了？',
        backToSignInLink: '返回登录',
        genericError: '暂时无法发送重置说明，请稍后再试。',
      },
      resetPassword: {
        title: '重置密码',
        description: '粘贴邮件中的重置令牌，并设置一个新密码。',
        tokenLabel: '重置令牌',
        tokenPlaceholder: '粘贴邮件中的令牌',
        passwordLabel: '新密码',
        confirmPasswordLabel: '确认密码',
        submit: '重置密码',
        submitting: '保存中...',
        mismatchError: '两次输入的密码不一致。',
        success: '密码重置完成。',
        requestNewLinkPrompt: '需要重新开始？',
        requestNewLinkLink: '申请新的重置链接',
        genericError: '暂时无法重置密码，请稍后再试。',
      },
      verifyEmail: {
        title: '验证邮箱',
        description: '我们正在为你准备安全的邮箱验证。',
        verifyingDescription: '正在验证你的邮箱链接...',
      },
      claim: {
        eyebrow: '共享通道访问',
        title: '认领你的客户账号',
        description: '为首次入站消息自动预建的账号设置密码，完成激活。',
        tokenLabel: '认领令牌',
        tokenPlaceholder: '粘贴邮件中的认领令牌',
        passwordLabel: '新密码',
        confirmPasswordLabel: '确认密码',
        submit: '激活账号',
        submitting: '正在激活...',
        mismatchError: '两次输入的密码不一致。',
        invalidOrExpiredError: '这个认领链接无效或已过期。',
        emailAlreadyExistsError: '该邮箱地址已被占用。请直接登录，或使用其他邮箱重新申请认领链接。',
        genericError: '暂时无法认领你的账号，请稍后再试。',
        signInPrompt: '已经认领过账号？',
        signInLink: '去登录',
      },
      channelsIndex: {
        eyebrow: '第一阶段通道',
        title: '客户通道',
        description: '管理当前已经迁移到中立 ClawScale 客户壳层中的通道入口。',
        wechatPersonalTitle: '个人微信',
        wechatPersonalDescription: '连接、重新连接或归档你的个人微信通道。',
      },
      bindWechat: {
        blocked: {
          accessEyebrow: '账号访问',
          suspendedTitle: '你的 Coke 账号已被停用',
          suspendedDescription: '请先联系支持恢复访问权限，然后再绑定个人微信通道。',
          prerequisitesTitle: '先完成邮箱验证和订阅续费，再创建微信通道。',
          prerequisitesDescription: '先把账号要求的步骤完成，再回来创建或重新连接你的微信通道。',
          verifyEmail: '验证邮箱',
          renewSubscription: '续费订阅',
        },
        loadFailure: {
          title: '无法加载你的微信通道',
        },
        loading: {
          title: '正在加载你的微信通道',
          description: '我们正在检查当前 Coke 账号绑定的个人微信通道状态。',
        },
        statusDescriptions: {
          missing: '先创建通道，然后再发起属于你自己的微信扫码登录会话。',
          archived: '归档通道不会再转发消息。若要重新开始，请创建一个新的通道。',
          disconnected: '通道已经存在，但尚未连接。发起扫码会话即可让它重新上线。',
        },
        qr: {
          imageAlt: '个人 Coke 微信登录二维码',
          preparing: '正在生成二维码...',
          expiresPrefix: '该二维码会话过期时间：',
          activeSuffix: '当前二维码会话仍然有效。',
        },
        connectedCard: {
          eyebrow: '已连接',
          descriptionWithIdentity: '微信 {identity} 已连接到这个 Coke 账号。',
          descriptionWithoutIdentity: '你的个人微信通道已连接并可正常使用。',
          accountOwnershipSuffix: '{name}，这个通道归属于你的 Coke 账号。',
        },
        errorCard: {
          eyebrow: '连接异常',
          fallbackDescription: '上一次连接尝试失败了。你可以重试，或归档这个通道。',
        },
        nextSteps: {
          title: '接下来可以做什么',
          missing: '为这个账号创建你的个人微信通道。',
          disconnected: '发起扫码登录会话，连接这个已存在的通道。',
          pending: '使用你希望拥有该通道的微信账号扫描二维码。',
          connected: '需要下线时，可以断开这个通道。',
          error: '重新走一次连接流程，或归档当前异常通道。',
          archived: '如果想重新开始，请创建一个新的通道。',
        },
        busyActions: {
          create: '创建中...',
          connect: '连接中...',
          refresh: '刷新中...',
          disconnect: '断开中...',
          reconnect: '重新连接中...',
          archive: '归档中...',
        },
        accountPrompt: '还没有账号？',
        createAccount: '创建一个',
        viewModel: {
          missing: {
            eyebrow: '尚未创建通道',
            title: '创建我的微信通道',
            description: '为这个 Coke 账号创建一个个人微信通道，然后通过扫码登录把它连接起来。',
            primaryActionLabel: '创建我的微信通道',
          },
          disconnected: {
            eyebrow: '通道已创建',
            title: '连接微信',
            description: '你的个人微信通道已经存在。发起扫码登录会话即可让它上线。',
            primaryActionLabel: '连接微信',
          },
          pending: {
            eyebrow: '扫码登录进行中',
            title: '扫描二维码完成连接',
            description: '使用下方二维码把你的个人通道登录到微信。',
            primaryActionLabel: '刷新二维码',
          },
          connected: {
            eyebrow: '已连接',
            title: '微信已连接',
            descriptionWithIdentity: '你的个人通道已使用 {identity} 连通。',
            descriptionWithoutIdentity: '你的个人微信通道已连接并可正常使用。',
            primaryActionLabel: '断开微信',
          },
          error: {
            eyebrow: '连接异常',
            title: '重新连接或归档通道',
            descriptionFallback: '上一次连接尝试失败。你可以重试，或归档这个通道。',
            primaryActionLabel: '重新连接',
            secondaryActionLabel: '归档通道',
          },
          archived: {
            eyebrow: '已归档',
            title: '这个微信通道已归档',
            description: '如果你还想继续使用微信，请重新创建一个新的个人通道。',
            primaryActionLabel: '重新创建我的微信通道',
          },
        },
      },
    },
    cokeUserPages: {
      renew: {
        title: '续订访问权限',
        preparing: '正在准备续费结账流程...',
        ready: '准备好后可重新进入结账流程。',
        signIn: '登录',
        backToSetup: '返回设置',
        genericError: '暂时无法发起续费，请稍后再试。',
      },
      paymentSuccess: {
        title: '支付完成',
        description: '我们已收到你的续费付款。返回账号后即可继续完成微信连接。',
        primaryCta: '前往微信设置',
        secondaryCta: '检查续费状态',
      },
      paymentCancel: {
        title: '支付已取消',
        description: '结账流程在付款完成前已取消。准备好后你可以再次尝试。',
        primaryCta: '重新发起续费',
        secondaryCta: '返回设置',
      },
    },
  },
};

declare global {
  interface Window {
    __COKE_LOCALE__?: Locale;
  }
}

export function readSupportedLocale(value: string | null | undefined): Locale | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return 'zh';
  }

  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en';
  }

  return null;
}

export function normalizeLocale(value: string | null | undefined): Locale {
  const parsedLocale = readSupportedLocale(value);
  if (parsedLocale) {
    return parsedLocale;
  }

  return DEFAULT_LOCALE;
}

export function detectLocaleFromNavigator(value: string | null | undefined): Locale {
  return normalizeLocale(value);
}

export function detectLocaleFromAcceptLanguage(value: string | null | undefined): Locale {
  if (!value) {
    return DEFAULT_LOCALE;
  }

  const candidates = value
    .split(',')
    .map((entry, index) => {
      const [range = '', ...params] = entry.trim().split(';');
      const qualityParam = params.find((param) => param.trim().startsWith('q='));
      const quality = qualityParam ? Number.parseFloat(qualityParam.split('=')[1] ?? '') : 1;

      return {
        index,
        quality: Number.isFinite(quality) ? quality : 1,
        range,
      };
    })
    .filter(({ range }) => range.length > 0)
    .map(({ index, quality, range }) => ({
      index,
      quality,
      locale: readSupportedLocale(range),
    }))
    .filter(({ locale, quality }) => locale !== null && quality > 0)
    .sort((left, right) => {
      if (right.quality !== left.quality) {
        return right.quality - left.quality;
      }

      return left.index - right.index;
    });

  return candidates[0]?.locale ?? DEFAULT_LOCALE;
}

export function resolveInitialLocale({
  cookieLocale,
  acceptLanguage,
}: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (cookieLocale != null && cookieLocale !== '') {
    const supportedLocale = readSupportedLocale(cookieLocale);
    if (supportedLocale) {
      return supportedLocale;
    }
  }

  return detectLocaleFromAcceptLanguage(acceptLanguage);
}

function readPersistedLocale(): Locale | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    const supportedLocale = readSupportedLocale(storedLocale);
    if (supportedLocale) {
      return supportedLocale;
    }
  } catch {
    // Ignore storage failures and fall back to cookies or navigator language.
  }

  try {
    const cookieLocale = document.cookie
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`))
      ?.split('=')[1];

    return readSupportedLocale(cookieLocale);
  } catch {
    return null;
  }
}

export function detectClientLocale(): Locale {
  const persistedLocale = readPersistedLocale();
  if (persistedLocale) {
    return persistedLocale;
  }

  if (typeof navigator !== 'undefined') {
    return detectLocaleFromNavigator(navigator.language);
  }

  return DEFAULT_LOCALE;
}

export function getBootstrappedLocale(): Locale | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return readSupportedLocale(window[LOCALE_BOOTSTRAP_KEY]);
}

export function getLocaleBootstrapScript(): string {
  return `(() => {
    try {
      const storageKey = ${JSON.stringify(LOCALE_STORAGE_KEY)};
      const cookieName = ${JSON.stringify(LOCALE_COOKIE_NAME)};
      const bootstrapKey = ${JSON.stringify(LOCALE_BOOTSTRAP_KEY)};
      const normalize = (value) => {
        const raw = String(value ?? '').trim().toLowerCase();
        if (raw === 'zh' || raw.startsWith('zh-')) return 'zh';
        if (raw === 'en' || raw.startsWith('en-')) return 'en';
        return null;
      };
      const readCookie = () => document.cookie
        .split(';')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(cookieName + '='))
        ?.split('=')[1];
      let locale = null;
      try {
        locale = normalize(localStorage.getItem(storageKey));
      } catch (error) {}
      if (!locale) {
        locale = normalize(readCookie());
      }
      if (!locale) {
        locale = normalize(navigator.language);
      }
      const resolvedLocale = locale || 'en';
      document.documentElement.lang = resolvedLocale;
      window[bootstrapKey] = resolvedLocale;
    } catch (error) {}
  })();`;
}
