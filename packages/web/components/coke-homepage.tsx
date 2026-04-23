'use client';

import Link from 'next/link';
import { useState, type CSSProperties, type FormEvent } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  Check,
  CheckCheck,
  MessageCircle,
  Route,
  Sparkles,
  Workflow as WorkflowIcon,
} from 'lucide-react';

import { type Locale } from '../lib/i18n';
import { CokePublicShell } from './coke-public-shell';
import { useLocale } from './locale-provider';

const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const HERO_DECOR = {
  en: {
    availability: 'Live now · WeChat · Telegram · WhatsApp',
    stickerLeft: 'You can close the tab.',
    stickerRight: 'Kap keeps moving.',
    chipA: 'Draft ready',
    chipB: '3 flows running',
  },
  zh: {
    availability: '已上线 · 微信 · Telegram · WhatsApp',
    stickerLeft: '你可以先去忙别的。',
    stickerRight: 'Kap 会继续推进。',
    chipA: '草稿已就绪',
    chipB: '3 条流程在跑',
  },
} satisfies Record<
  Locale,
  {
    availability: string;
    stickerLeft: string;
    stickerRight: string;
    chipA: string;
    chipB: string;
  }
>;

const HERO_STAGE_COPY = {
  en: {
    label: 'Kap AI',
    body: 'One ongoing conversation for planning, reminders, and follow-through.',
  },
  zh: {
    label: 'Kap AI',
    body: '用一个持续的对话，把规划、提醒和推进都接起来。',
  },
} satisfies Record<Locale, { label: string; body: string }>;

const TICKER_ITEMS = {
  en: [
    'Keep momentum after the first message',
    'Close the tab, Kap keeps working',
    'Return to a clearer next move',
    'One thread, multiple outcomes',
  ],
  zh: ['先发一条，后续继续推进', '关掉页面，Kap 继续做事', '回来就有更清晰的下一步', '一个线程，多个结果'],
} satisfies Record<Locale, readonly string[]>;

const CAPABILITY_CARDS = {
  en: [
    {
      tone: 'c1',
      eyebrow: 'Start fast',
      title: 'Use the public homepage as a launchpad, not a brochure.',
      body: 'The first screen points straight to sign-in, registration, and channel setup instead of hiding the product behind generic marketing copy.',
    },
    {
      tone: 'c2',
      eyebrow: 'One shell',
      title: 'Kap now carries one visual system across the public journey.',
      body: 'Homepage, auth, and customer surfaces all inherit the same warm palette, stamped controls, and bold hierarchy.',
    },
    {
      tone: 'c3',
      eyebrow: 'Persistent context',
      title: 'The conversation preview promises follow-through, not one-off answers.',
      body: 'Planning, reminders, subscription state, and setup actions all stay connected instead of living in separate visual worlds.',
    },
    {
      tone: 'c4',
      eyebrow: 'Clear routes',
      title: 'Registration, login, renewal, and WeChat setup stay explicit.',
      body: 'No route changes, no hidden jumps. The redesign only changes presentation and branding, not product behavior.',
    },
    {
      tone: 'c5',
      eyebrow: 'Brand reset',
      title: 'Kap now anchors every visible brand touchpoint.',
      body: 'Shared shells, homepage copy, global WhatsApp funnel, auth text, and customer-facing account pages all speak in the same brand voice.',
    },
  ],
  zh: [
    {
      tone: 'c1',
      eyebrow: '快速开始',
      title: '公开首页应该是启动台，而不是只会讲故事的 brochure。',
      body: '第一屏直接把用户带到登录、注册和通道设置，不再用泛泛的营销语言挡住真实入口。',
    },
    {
      tone: 'c2',
      eyebrow: '统一外壳',
      title: 'Kap 现在用一套视觉系统贯穿公开链路。',
      body: '首页、认证、客户页面共享同一套暖色调、印章式按钮和更强的视觉层级。',
    },
    {
      tone: 'c3',
      eyebrow: '持续上下文',
      title: '对话预览强调的是持续推进，不是一次性回答。',
      body: '规划、提醒、续费状态和微信设置都在同一种产品叙事里，不再像几个拼起来的页面。',
    },
    {
      tone: 'c4',
      eyebrow: '路径清晰',
      title: '注册、登录、续费、微信设置这些关键入口仍然非常明确。',
      body: '这次改版不碰路由和行为，只调整呈现方式和品牌语言。',
    },
    {
      tone: 'c5',
      eyebrow: '品牌切换',
      title: '所有用户可见的品牌触点现在都统一成 Kap。',
      body: '共享 shell、主页文案、WhatsApp 落地页、auth 文案以及客户账号页都会用同一套 Kap 品牌表达。',
    },
  ],
} satisfies Record<
  Locale,
  ReadonlyArray<{ tone: 'c1' | 'c2' | 'c3' | 'c4' | 'c5'; eyebrow: string; title: string; body: string }>
>;

const SCENARIOS = {
  en: [
    {
      tag: 'Planning',
      title: 'Prepare tomorrow before the day starts.',
      body: 'Use Kap to line up meetings, notes, reminders, and the first follow-up before the morning gets noisy.',
      previewClass: 'o',
      preview: [
        { type: 'me', text: 'Need the day lined up before 10am.' },
        { type: 'ai', text: 'I can sort the order, draft the follow-up, and remind you before the first handoff.' },
        { type: 'file', text: 'Tomorrow-plan.md', meta: 'Agenda, follow-up draft, and reminder timing' },
      ],
    },
    {
      tag: 'Channels',
      title: 'Bring the assistant into the channel you already use.',
      body: 'From homepage to WeChat setup, the path stays visually coherent and operationally explicit.',
      previewClass: 'g',
      preview: [
        { type: 'me', text: 'I want this tied to my personal WeChat.' },
        { type: 'ai', text: 'Create the channel, scan the QR code, and I will keep the setup state visible.' },
        { type: 'file', text: 'wechat-setup', meta: 'QR login, connection state, and reconnect actions' },
      ],
    },
    {
      tag: 'Renewal',
      title: 'Handle blocked access without losing the thread.',
      body: 'Subscription and verification pages should feel like part of the product, not a disconnected billing detour.',
      previewClass: 'b',
      preview: [
        { type: 'me', text: 'What do I need before I can reconnect?' },
        { type: 'ai', text: 'Verify email, renew access, then come back here to reconnect the channel.' },
        { type: 'file', text: 'account-status', meta: 'Verification, renewal, and return-to-setup actions' },
      ],
    },
    {
      tag: 'Global',
      title: 'Use the WhatsApp page as a focused global funnel.',
      body: 'The global route still points to one chat entrypoint, but now it feels like the same product as the main site.',
      previewClass: '',
      preview: [
        { type: 'me', text: 'I just want to start on WhatsApp.' },
        { type: 'ai', text: 'Open the chat, send one message, and stay in the same thread for the next move.' },
        { type: 'file', text: 'global-entry', meta: 'WhatsApp CTA with the same Kap brand language' },
      ],
    },
  ],
  zh: [
    {
      tag: '规划',
      title: '在一天真正开始之前，把明天先排出来。',
      body: '让 Kap 先把会议、笔记、提醒和第一条 follow-up 排好，早上就不会被噪音打断。',
      previewClass: 'o',
      preview: [
        { type: 'me', text: '明天 10 点前，帮我把整天先排顺。' },
        { type: 'ai', text: '我来整理顺序、起草跟进消息，并在第一个 handoff 前提醒你。' },
        { type: 'file', text: '明日计划.md', meta: '议程、跟进草稿和提醒时间' },
      ],
    },
    {
      tag: '通道',
      title: '把助手直接带进你已经在用的渠道里。',
      body: '从首页到个人微信设置，整条路径应该既统一又清楚，而不是多个页面各说各话。',
      previewClass: 'g',
      preview: [
        { type: 'me', text: '我想把它接到自己的微信里。' },
        { type: 'ai', text: '先创建通道，再扫二维码登录，我会把整个连接状态持续显示出来。' },
        { type: 'file', text: '微信设置', meta: '扫码登录、连接状态、重连动作' },
      ],
    },
    {
      tag: '续费',
      title: '访问受阻时，也不要把用户从主产品体验里甩出去。',
      body: '续费和验证页面应该还是同一个产品的一部分，而不是割裂的计费流程。',
      previewClass: 'b',
      preview: [
        { type: 'me', text: '重新连上之前，我还差什么？' },
        { type: 'ai', text: '先完成邮箱验证和续费，然后回到这里继续重连通道。' },
        { type: 'file', text: '账号状态', meta: '验证、续费与回到设置的动作' },
      ],
    },
    {
      tag: '全球入口',
      title: '把 WhatsApp 页面做成更聚焦的全球入口。',
      body: '它仍然只服务一个聊天入口，但现在会像同一个产品，而不是额外拼出来的落地页。',
      previewClass: '',
      preview: [
        { type: 'me', text: '我就想直接从 WhatsApp 开始。' },
        { type: 'ai', text: '打开聊天，先发一条消息，后面的动作都在同一个线程里继续。' },
        { type: 'file', text: '全球入口', meta: 'WhatsApp CTA 与统一的 Kap 品牌语气' },
      ],
    },
  ],
} satisfies Record<
  Locale,
  ReadonlyArray<{
    tag: string;
    title: string;
    body: string;
    previewClass: string;
    preview: ReadonlyArray<{ type: 'me' | 'ai' | 'file'; text: string; meta?: string }>;
  }>
>;

const QUOTE_BAND = {
  en: {
    quote: 'It should not feel like a set of disconnected screens.',
    accent: 'It should feel like one product that keeps the task moving.',
    cite: 'Kap public redesign',
  },
  zh: {
    quote: '它不应该只是几个互不相干的页面拼在一起。',
    accent: '它应该像一个会持续推进任务的完整产品。',
    cite: 'Kap 公开站点改版',
  },
} satisfies Record<Locale, { quote: string; accent: string; cite: string }>;

const VOICES = {
  en: [
    {
      avatar: 'PM',
      role: 'Product',
      quote: 'The public site now points to a real workflow instead of hovering above the product.',
    },
    {
      avatar: 'OP',
      role: 'Operations',
      quote: 'Account recovery, renewal, and channel setup finally look like the same service.',
    },
    {
      avatar: 'UX',
      role: 'Design',
      quote: 'The warmer palette and stamped controls make the interface feel intentional instead of generic.',
    },
  ],
  zh: [
    {
      avatar: '产',
      role: '产品',
      quote: '公开首页终于不只是讲愿景，而是真的把用户带进一条可执行的流程。',
    },
    {
      avatar: '运',
      role: '运营',
      quote: '账号找回、续费和微信设置终于像同一个服务，而不是几个割裂页面。',
    },
    {
      avatar: '设',
      role: '设计',
      quote: '暖色调和印章式控件让整个界面终于有了明确的性格，而不是模板味。',
    },
  ],
} satisfies Record<Locale, ReadonlyArray<{ avatar: string; role: string; quote: string }>>;

const FOOTER_LINKS = {
  product: ['/#capabilities', '/#scenarios', '/#voices'],
  account: ['/auth/login', '/auth/register', '/channels/wechat-personal', '/account/subscription'],
  company: ['/', '/#download', '#'],
} as const;

export function CokeHomepage() {
  const { locale } = useLocale();

  return (
    <CokePublicShell>
      <Hero locale={locale} />
      <Ticker locale={locale} />
      <Capabilities locale={locale} />
      <Scenarios locale={locale} />
      <QuoteBand locale={locale} />
      <Voices locale={locale} />
      <DownloadPanel locale={locale} />
      <Footer />
    </CokePublicShell>
  );
}

function Hero({ locale }: { locale: Locale }) {
  const {
    messages: {
      homepage: { hero, stats },
    },
  } = useLocale();
  const decor = HERO_DECOR[locale];
  const stageCopy = HERO_STAGE_COPY[locale];

  return (
    <section className="hero">
      <div className="wrap">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="hero-tag">
              <span className="dot" />
              {decor.availability}
            </span>

            <h1 className="hero__title">
              <span className="line">{hero.titleLine1}</span>
              <span className="line">
                <em>{hero.titleItalicMiddle}</em>
              </span>
              <span className="line">{hero.titleLine3}</span>
            </h1>
            <p style={visuallyHiddenStyle}>{hero.subtitle}</p>

            <p className="hero-lead">{hero.body}</p>

            <div className="hero-cta-group">
              <Link href="/auth/register" className="btn-sticker">
                {hero.primaryCta}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link href="/auth/login" className="btn-ghost">
                {hero.secondaryCta}
              </Link>
            </div>

            <div className="hero-stats">
              {stats.slice(0, 3).map((stat) => (
                <div key={stat.label} className="stat">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-stage" aria-hidden="true">
            <div className="chip a">
              <span className="ic">✓</span>
              {decor.chipA}
            </div>
            <div className="chip b">
              <span className="ic alt">~</span>
              {decor.chipB}
            </div>

            <div className="hero-card">
              <div className="hero-sky" />
              <div className="hero-ground" />
              <div className="sun" />
              <div className="cloud c1" />
              <div className="cloud c2" />
              <div className="tag-speech">{decor.stickerLeft}</div>
              <div className="tag-speech r">{decor.stickerRight}</div>

              <div className="hero-mascots">
                <div className="hero-mascot hero-mascot--olive">K</div>
                <div className="hero-mascot hero-mascot--orange">AI</div>
              </div>

              <div className="hero-stage-card">
                <div className="hero-stage-card__top">
                  <MessageCircle size={15} aria-hidden="true" />
                  <div>
                    <strong>{stageCopy.label}</strong>
                    <p>{stageCopy.body}</p>
                  </div>
                </div>
                <div className="hero-stage-card__thread">
                  <div className="bubble bubble--user">Plan the next move and keep the thread warm.</div>
                  <div className="bubble bubble--coke">
                    <span className="bubble__tag">Kap</span>
                    <span className="bubble__text">
                      {locale === 'zh'
                        ? '我会继续推进这件事，并在你回来时给你更清楚的下一步。'
                        : "I'll keep this moving and bring you back to a clearer next step."}
                    </span>
                    <span className="bubble__status">
                      <CheckCheck size={11} />
                      {locale === 'zh' ? '已同步' : 'Synced'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Ticker({ locale }: { locale: Locale }) {
  const items = TICKER_ITEMS[locale];

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {[...items, ...items].map((item, index) => (
          <span key={`${item}-${index}`}>
            {item}
            <span className="sep">●</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Capabilities({ locale }: { locale: Locale }) {
  const cards = CAPABILITY_CARDS[locale];

  return (
    <section className="block" id="capabilities">
      <div className="wrap">
        <span className="eyebrow">{locale === 'zh' ? '核心能力' : 'Capabilities'}</span>
        <h2>
          {locale === 'zh' ? '不是只把页面换个颜色，' : 'Not just a new coat of paint,'}
          <br />
          <em>{locale === 'zh' ? '而是把公开体验收成一个完整产品。' : 'but one public experience that feels coherent.'}</em>
        </h2>
        <p className="lead">
          {locale === 'zh'
            ? '这轮改版把主页、认证、客户页面和全球入口统一成同一种产品语言，让用户从第一屏到关键操作都不会掉出上下文。'
            : 'This pass pulls homepage, auth, customer surfaces, and the global funnel into one product language so users do not fall out of context between screens.'}
        </p>

        <div className="caps">
          {cards.map((card, index) => (
            <article key={card.title} className={`cap ${card.tone}`}>
              <span className="num">{String(index + 1).padStart(2, '0')}</span>
              <div className="eyebrow">{card.eyebrow}</div>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <div className="illus">
                {index === 0 ? <MessageCircle size={28} /> : null}
                {index === 1 ? <WorkflowIcon size={28} /> : null}
                {index === 2 ? <Route size={28} /> : null}
                {index === 3 ? <CalendarCheck size={28} /> : null}
                {index === 4 ? <Activity size={28} /> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Scenarios({ locale }: { locale: Locale }) {
  const scenarios = SCENARIOS[locale];

  return (
    <section className="block scenarios-block" id="scenarios">
      <div className="wrap">
        <span className="eyebrow">{locale === 'zh' ? '使用场景' : 'Scenarios'}</span>
        <h2>
          {locale === 'zh' ? '让真实入口、真实状态、真实下一步' : 'Show the real entrypoints,'}
          <br />
          <span className="accent">{locale === 'zh' ? '在同一套视觉里出现。' : 'real state, and real next steps.'}</span>
        </h2>
        <p className="lead">
          {locale === 'zh'
            ? '参考稿的价值不在于某个 hero，而在于它把营销表达和实际操作感揉成了一个页面。'
            : 'The reference works because it fuses marketing energy with operational clarity instead of separating them into different visual worlds.'}
        </p>

        <div className="scen-grid">
          {scenarios.map((scenario) => (
            <article key={scenario.title} className="scen">
              <span className="scn-tag">{scenario.tag}</span>
              <h3>{scenario.title}</h3>
              <p>{scenario.body}</p>
              <div className={`preview ${scenario.previewClass}`.trim()}>
                {scenario.preview.map((item) => (
                  <div key={`${scenario.title}-${item.text}`} className={`bubble ${item.type}`}>
                    {item.text}
                    {item.meta ? <small>{item.meta}</small> : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function QuoteBand({ locale }: { locale: Locale }) {
  const quote = QUOTE_BAND[locale];

  return (
    <section className="quoteband">
      <div className="inner">
        <blockquote>
          {quote.quote}
          <br />
          <span>{quote.accent}</span>
        </blockquote>
        <div className="cite">— {quote.cite}</div>
      </div>
    </section>
  );
}

function Voices({ locale }: { locale: Locale }) {
  const voices = VOICES[locale];

  return (
    <section className="block" id="voices">
      <div className="wrap">
        <span className="eyebrow">{locale === 'zh' ? '用户声音' : 'Proof'}</span>
        <h2>{locale === 'zh' ? '让公开站点更像产品，' : 'Make the public site feel'} <span className="accent">{locale === 'zh' ? '而不是模板。' : 'like the product, not the template.'}</span></h2>
        <div className="voices">
          {voices.map((voice) => (
            <div key={`${voice.avatar}-${voice.role}`} className="voice">
              <div className="head">
                <div className="avatar">{voice.avatar}</div>
                <div>
                  <div className="who">Kap</div>
                  <div className="role">{voice.role}</div>
                </div>
              </div>
              <div className="stars">★★★★★</div>
              <blockquote>{voice.quote}</blockquote>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DownloadPanel({ locale }: { locale: Locale }) {
  const {
    messages: { homepage },
  } = useLocale();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      return;
    }
    setSubmitted(true);
  }

  return (
    <section className="block" id="download">
      <div className="wrap">
        <div className="dl-card">
          <div>
            <span className="eyebrow">{locale === 'zh' ? '开始使用 Kap' : 'Start with Kap'}</span>
            <h2>{locale === 'zh' ? '先用一个真实动作，\n把产品打开。' : 'Start with one real action,\nthen keep the thread alive.'}</h2>
            <p className="lead">
              {homepage.contact.body}
            </p>

            <form className="download-form" onSubmit={handleSubmit}>
              {submitted ? (
                <div className="download-thanks">
                  <Check size={16} aria-hidden="true" />
                  {homepage.contact.thanks}
                </div>
              ) : (
                <>
                  <input
                    className="download-input"
                    type="email"
                    placeholder={homepage.contact.placeholder}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  <button type="submit" className="btn-sticker">
                    {homepage.contact.primaryCta}
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                  <Link href="/auth/login" className="btn-ghost">
                    {homepage.contact.secondaryCta}
                  </Link>
                </>
              )}
            </form>

            <p className="download-note">{homepage.contact.note}</p>
          </div>

          <div className="plats">
            <Link href="/auth/register" className="plat">
              {locale === 'zh' ? '注册' : 'Register'}
              <small>{locale === 'zh' ? '公开入口' : 'Public entry'}</small>
            </Link>
            <Link href="/auth/login" className="plat">
              {locale === 'zh' ? '登录' : 'Sign in'}
              <small>{locale === 'zh' ? '已有账号' : 'Existing account'}</small>
            </Link>
            <Link href="/channels/wechat-personal" className="plat">
              {locale === 'zh' ? '微信设置' : 'WeChat setup'}
              <small>{locale === 'zh' ? '个人通道' : 'Personal channel'}</small>
            </Link>
            <Link href="/account/subscription" className="plat">
              {locale === 'zh' ? '订阅状态' : 'Renewal'}
              <small>{locale === 'zh' ? '账号访问' : 'Account access'}</small>
            </Link>
            <Link href="/global" className="plat">
              WhatsApp
              <small>{locale === 'zh' ? '全球入口' : 'Global entry'}</small>
            </Link>
            <Link href="/" className="plat">
              Kap AI
              <small>{locale === 'zh' ? '主站首页' : 'Main homepage'}</small>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const {
    messages: { homepage },
  } = useLocale();

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <Link href="/" className="site-footer__brand brand" aria-label="Kap AI">
            <span className="brand__mark">kap</span>
            <span className="brand__dot" aria-hidden="true" />
          </Link>
          <p className="site-footer__copy">{homepage.footer.tagline}</p>
        </div>

        <div className="site-footer__cols">
          <div>
            <div className="site-footer__h">{homepage.footer.productHeading}</div>
            {homepage.footer.productLinks.map((label, index) => (
              <Link key={label} href={FOOTER_LINKS.product[index] ?? '#'}>
                {label}
              </Link>
            ))}
          </div>
          <div>
            <div className="site-footer__h">{homepage.footer.accountHeading}</div>
            {homepage.footer.accountLinks.map((label, index) => (
              <Link key={label} href={FOOTER_LINKS.account[index] ?? '#'}>
                {label}
              </Link>
            ))}
          </div>
          <div>
            <div className="site-footer__h">{homepage.footer.companyHeading}</div>
            {homepage.footer.companyLinks.map((label, index) => (
              <Link key={label} href={FOOTER_LINKS.company[index] ?? '#'}>
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="site-footer__bar">
        <span>{homepage.footer.copyright}</span>
        <span>Kap AI</span>
      </div>
    </footer>
  );
}
