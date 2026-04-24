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

import { KapKoalaBadge, KapKoalaHero } from './kap-brand';
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
      eyebrow: 'Plan',
      title: 'Plan meetings, reminders, and the next move in one thread.',
      body: 'Use Kap to line up tomorrow, a busy afternoon, or the first handoff before the context cools down.',
    },
    {
      tone: 'c2',
      eyebrow: 'Draft',
      title: 'Turn the loose thought into a sendable message.',
      body: 'Ask Kap to draft replies, summaries, handoff notes, and check-in messages before you lose the thread.',
    },
    {
      tone: 'c3',
      eyebrow: 'Remind',
      title: 'Do not stop at the answer. Keep the task moving.',
      body: 'Carry reminders, follow-through, and open loops in the same conversation instead of restarting from zero.',
    },
    {
      tone: 'c4',
      eyebrow: 'Connect',
      title: 'Start on the web, then continue in the channel you actually use.',
      body: 'Sign in, register, personal WeChat setup, and WhatsApp entry points should feel like one product.',
    },
    {
      tone: 'c5',
      eyebrow: 'Recover',
      title: 'When access breaks, the next required action should still be obvious.',
      body: 'Email verification, renewal, and reconnect steps stay readable instead of sending you into a detached flow.',
    },
  ],
  zh: [
    {
      tone: 'c1',
      eyebrow: '规划',
      title: '把会议、提醒和下一步放进同一个线程里。',
      body: '让 Kap 先帮你排顺明天、一个忙乱的下午，或第一个 handoff 之前该做的事。',
    },
    {
      tone: 'c2',
      eyebrow: '起草',
      title: '把要发出去的那条消息先起草出来。',
      body: '在上下文还热的时候，让 Kap 先起草回复、总结、handoff 说明和跟进消息。',
    },
    {
      tone: 'c3',
      eyebrow: '提醒',
      title: '不要只拿到答案，还要把事情继续推进。',
      body: '把提醒、跟进和待办都留在同一个线程里，不用每次重新讲一遍背景。',
    },
    {
      tone: 'c4',
      eyebrow: '连接',
      title: '先从网页开始，再继续到你真正使用的渠道里。',
      body: '登录、注册、个人微信设置和 WhatsApp 入口应该像同一个产品，而不是分开的几段流程。',
    },
    {
      tone: 'c5',
      eyebrow: '恢复',
      title: '访问受阻时，下一步该做什么也要一眼看懂。',
      body: '邮箱验证、续费和重连动作保持清楚，不把你甩进割裂的恢复流程里。',
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
      title: 'Line up tomorrow before the first meeting.',
      body: 'Give Kap the rough plan first, then come back to a cleaner order, a draft follow-up, and a useful reminder.',
      previewClass: 'o',
      preview: [
        { type: 'me', text: 'Before 10am, sort the day and tell me what lands first.' },
        { type: 'ai', text: 'I will line up the order, draft the first follow-up, and remind you before the handoff.' },
        { type: 'file', text: 'Tomorrow-plan.md', meta: 'Agenda, follow-up draft, and reminder timing' },
      ],
    },
    {
      tag: 'Draft',
      title: 'Turn the loose thought into a message you can send.',
      body: 'When you already know the intent, let Kap draft the follow-up, summary, or handoff note before it fades.',
      previewClass: 'g',
      preview: [
        { type: 'me', text: 'Need a calm follow-up after today’s meeting.' },
        { type: 'ai', text: 'I will draft the note and keep a cleaner version ready for you.' },
        { type: 'file', text: 'follow-up-draft', meta: 'Reply draft, summary, and handoff note' },
      ],
    },
    {
      tag: 'WeChat',
      title: 'Reconnect your personal channel without guessing the state.',
      body: 'If you need your own WeChat channel back online, Kap should keep the setup state and next action clear.',
      previewClass: 'b',
      preview: [
        { type: 'me', text: 'What do I need before I reconnect my WeChat?' },
        { type: 'ai', text: 'Check verification, renew access if needed, then scan to reconnect.' },
        { type: 'file', text: 'wechat-status', meta: 'Connection state, verification, and reconnect action' },
      ],
    },
    {
      tag: 'WhatsApp',
      title: 'Start globally with one message and stay in the same thread.',
      body: 'The global entry stays focused on WhatsApp, but it should still feel like the same Kap product.',
      previewClass: '',
      preview: [
        { type: 'me', text: 'I want to start from WhatsApp only.' },
        { type: 'ai', text: 'Open the chat, send the task once, and keep the next steps in the same thread.' },
        { type: 'file', text: 'whatsapp-entry', meta: 'Direct chat start and the next action' },
      ],
    },
  ],
  zh: [
    {
      tag: '规划',
      title: '在第一场会开始前，把明天先排顺。',
      body: '先把粗略计划交给 Kap，回来时你会拿到更顺的顺序、第一条草稿和有用的提醒。',
      previewClass: 'o',
      preview: [
        { type: 'me', text: '10 点前，先帮我排顺明天的顺序。' },
        { type: 'ai', text: '我来整理顺序、起草第一条跟进，并在 handoff 前提醒你。' },
        { type: 'file', text: '明日计划.md', meta: '议程、跟进草稿和提醒时间' },
      ],
    },
    {
      tag: '起草',
      title: '把脑子里那句模糊的话，先变成能发出去的消息。',
      body: '当你的意图已经明确时，让 Kap 先把跟进、总结或 handoff 说明起草出来。',
      previewClass: 'g',
      preview: [
        { type: 'me', text: '帮我起草今天会后的跟进。' },
        { type: 'ai', text: '我会先写出一版稳妥的消息，再给你留一版更精简的。' },
        { type: 'file', text: '跟进草稿', meta: '回复草稿、总结和 handoff 说明' },
      ],
    },
    {
      tag: '微信',
      title: '重连个人微信时，不要靠猜来判断状态。',
      body: '如果你要把自己的微信重新连上，Kap 应该把连接状态和下一步动作说清楚。',
      previewClass: 'b',
      preview: [
        { type: 'me', text: '重新连微信之前，我还差哪一步？' },
        { type: 'ai', text: '先检查验证状态，需要的话先续费，然后回来扫码重连。' },
        { type: 'file', text: '微信状态', meta: '连接状态、验证状态与重连动作' },
      ],
    },
    {
      tag: 'WhatsApp',
      title: '从一条 WhatsApp 消息开始，然后留在同一个线程里继续。',
      body: '全球入口只服务 WhatsApp，但它也应该像同一个 Kap 产品，而不是另一套落地页。',
      previewClass: '',
      preview: [
        { type: 'me', text: '我就想从 WhatsApp 直接开始。' },
        { type: 'ai', text: '打开聊天，把任务先发出去，后面的下一步都留在同一个线程里。' },
        { type: 'file', text: 'WhatsApp 入口', meta: '直接开聊与后续动作' },
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
    quote: 'Give Kap the task once.',
    accent: 'Come back to a clearer next move.',
    cite: 'Kap',
  },
  zh: {
    quote: '把任务交给 Kap 一次。',
    accent: '回来时拿到更清楚的下一步。',
    cite: 'Kap',
  },
} satisfies Record<Locale, { quote: string; accent: string; cite: string }>;

const VOICES = {
  en: [
    {
      avatar: 'OP',
      role: 'Founder',
      quote: 'When I open Kap in the morning, the order, the reminder, and the first follow-up are already clearer.',
    },
    {
      avatar: 'CS',
      role: 'Support',
      quote: 'When WeChat drops, I can see whether the next move is verification, renewal, or a fresh scan.',
    },
    {
      avatar: 'GL',
      role: 'Global',
      quote: 'Switching between the web entry and WhatsApp no longer feels like learning two different products.',
    },
  ],
  zh: [
    {
      avatar: '产',
      role: '创始人',
      quote: '早上打开时，Kap 已经把会议顺序、提醒和第一条跟进整理得更清楚了。',
    },
    {
      avatar: '运',
      role: '支持',
      quote: '微信掉线后，我能直接看见下一步是该验证邮箱、续费，还是重新扫码。',
    },
    {
      avatar: '设',
      role: '全球',
      quote: '我在网页和 WhatsApp 之间切换时，不需要重新理解另一套产品。',
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

              <div className="hero-mascot-figure">
                <KapKoalaHero />
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
          {locale === 'zh' ? 'Kap 应该像一条持续推进的工作线程，' : 'Kap should feel like one steady operating thread,'}
          <br />
          <em>{locale === 'zh' ? '从第一屏一直到下一步。' : 'from the first page to the next action.'}</em>
        </h2>
        <p className="lead">
          {locale === 'zh'
            ? '把计划、草稿、提醒、重连和继续推进放进同一套产品体验里，用户才不会在关键动作前掉出上下文。'
            : 'Planning, drafting, reminders, reconnect flows, and the next action should all live inside the same product experience.'}
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
        <span className="eyebrow">{locale === 'zh' ? '真实任务' : 'Real tasks'}</span>
        <h2>
          {locale === 'zh' ? '从一个真实任务开始，' : 'Start from a real task,'}
          <br />
          <span className="accent">{locale === 'zh' ? '然后把它继续推进。' : 'then keep it moving.'}</span>
        </h2>
        <p className="lead">
          {locale === 'zh'
            ? 'Kap 的价值不在于一段漂亮文案，而在于你把事情交给它之后，它会继续把下一步往前带。'
            : 'Kap matters when it helps carry a real task forward after the first message, not when it only sounds good in a headline.'}
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
        <span className="eyebrow">{locale === 'zh' ? '真实反馈' : 'Proof'}</span>
        <h2>{locale === 'zh' ? '人们回来，不是为了看界面，' : 'People return for the next move,'} <span className="accent">{locale === 'zh' ? '而是为了让事情继续往前。' : 'not to admire the interface.'}</span></h2>
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
            <KapKoalaBadge className="brand__icon" />
            <span className="brand__mark">kap</span>
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
