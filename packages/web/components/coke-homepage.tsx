'use client';

import Link from 'next/link';
import { useState, type CSSProperties, type FormEvent } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bird,
  Briefcase,
  CalendarCheck,
  Check,
  CheckCheck,
  Gamepad2,
  Hash,
  MessageCircle,
  Route,
  Send,
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

const PLATFORM_CARDS = [
  { name: 'WeChat', Icon: MessageCircle, noteEn: 'Personal · QR login', noteZh: '个人号 · 扫码上线' },
  { name: 'Telegram', Icon: Send, noteEn: 'Bot token', noteZh: 'Bot token' },
  { name: 'DingTalk', Icon: Briefcase, noteEn: 'Enterprise', noteZh: '企业协作' },
  { name: 'Lark', Icon: Bird, noteEn: 'Group bot', noteZh: '飞书 · 群机器人' },
  { name: 'Slack', Icon: Hash, noteEn: 'Socket Mode', noteZh: 'Socket Mode' },
  { name: 'Discord', Icon: Gamepad2, noteEn: 'Community', noteZh: '社区' },
] as const;

const FEATURE_ICONS = [CalendarCheck, Route, Activity, WorkflowIcon] as const;

const CHAT_PEEK_THREADS = {
  en: [
    { who: 'user', text: 'free before 2pm tomorrow for a quick retro?' },
    {
      who: 'coke',
      text: "You're clear until 2:30. Want me to invite Lin and Rui and pull the action items from the last one?",
    },
    { who: 'user', text: 'yes, and add a note about the shipping delay' },
    { who: 'coke', text: "Sent. I'll nudge you 15 minutes before.", status: 'Delivered' },
  ],
  zh: [
    { who: 'user', text: '明天下午两点前有空开个复盘吗' },
    {
      who: 'coke',
      text: '我看了你下午的日程，2:30 之前完全空着。要不要我顺便给 Lin 和 Rui 发个邀请，再整理一份这周要聊的重点？',
    },
    { who: 'user', text: '好，顺便把上次的 action items 带上' },
    { who: 'coke', text: '已发。我会在会前 15 分钟提醒你。', status: '已送达' },
  ],
} satisfies Record<Locale, ReadonlyArray<{ who: 'user' | 'coke'; text: string; status?: string }>>;

const CHAT_PEEK_META = {
  en: {
    name: 'Work channel',
    meta: 'Coke AI · online',
    composer: 'Coke is drafting your next follow-up...',
  },
  zh: {
    name: '工作频道',
    meta: 'Coke AI · 在线',
    composer: 'Coke 正在为今天整理待办...',
  },
} as const satisfies Record<Locale, { name: string; meta: string; composer: string }>;

const FOOTER_LINKS = {
  product: ['/#platforms', '/#features', '/#architecture'],
  account: ['/auth/login', '/auth/register', '/account/subscription'],
  company: ['/', '/#contact', '#'],
} as const;

export function CokeHomepage() {
  const { locale } = useLocale();

  return (
    <CokePublicShell>
      <Hero locale={locale} />
      <Platforms />
      <Features />
      <Architecture />
      <Contact />
      <Footer />
    </CokePublicShell>
  );
}

function Hero({ locale }: { locale: Locale }) {
  const {
    messages: {
      homepage: { hero },
    },
  } = useLocale();

  return (
    <section className="hero">
      <div className="hero__grid">
        <div className="hero__copy">
          <div className="hero__eyebrow">
            <span className="hero__eyebrow-dot" aria-hidden="true" />
            <span>{hero.eyebrow}</span>
          </div>

          <h1 className="hero__title">
            <span>{hero.titleLine1}</span>
            <br />
            <em className="hero__title-em">{hero.titleItalicMiddle}</em>
            <br />
            <span>{hero.titleLine3}</span>
          </h1>
          <p style={visuallyHiddenStyle}>{hero.subtitle}</p>

          <p className="hero__lede">{hero.body}</p>

          <div className="hero__ctas">
            <Link href="/auth/register" className="btn btn--primary">
              {hero.primaryCta}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link href="/auth/login" className="btn btn--link">
              {hero.secondaryCta}
            </Link>
          </div>

          <div className="hero__foot">{hero.foot}</div>
        </div>

        <div className="hero__peek">
          <ChatPeek locale={locale} />
        </div>
      </div>
    </section>
  );
}

function ChatPeek({ locale }: { locale: Locale }) {
  const meta = CHAT_PEEK_META[locale];
  const thread = CHAT_PEEK_THREADS[locale];

  return (
    <div className="chat-peek" aria-hidden="true">
      <div className="chat-peek__chrome">
        <div className="chat-peek__dots">
          <span />
          <span />
          <span />
        </div>
        <div className="chat-peek__title">
          <span className="chat-peek__avatar">
            <MessageCircle size={12} />
          </span>
          <div>
            <div className="chat-peek__name">{meta.name}</div>
            <div className="chat-peek__meta">{meta.meta}</div>
          </div>
        </div>
        <div className="chat-peek__platform">WeChat</div>
      </div>

      <div className="chat-peek__body">
        {thread.map((message, index) => (
          <div key={index} className={`bubble bubble--${message.who}`}>
            {message.who === 'coke' ? (
              <div className="bubble__sender">
                <span className="bubble__tag">Coke</span>
              </div>
            ) : null}
            <div className="bubble__text">{message.text}</div>
            {message.status ? (
              <div className="bubble__status">
                <CheckCheck size={11} />
                {message.status}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="chat-peek__composer">
        <div className="chat-peek__composer-input">
          <Sparkles size={13} style={{ color: 'var(--claw-500)' }} />
          <span>{meta.composer}</span>
        </div>
      </div>
    </div>
  );
}

function Platforms() {
  const {
    locale,
    messages: { homepage },
  } = useLocale();

  return (
    <section id="platforms" className="section">
      <div className="section__head">
        <div className="section__eyebrow">
          <span className="section__num">01</span>
          <span>{homepage.platforms.eyebrow}</span>
        </div>
        <h2 className="section__title">{homepage.platforms.title}</h2>
        <p className="section__sub">{homepage.platforms.subtitle}</p>
      </div>

      <div className="platforms">
        {PLATFORM_CARDS.map(({ name, Icon, noteEn, noteZh }) => (
          <div key={name} className="platform">
            <div className="platform__icon">
              <Icon size={16} aria-hidden="true" />
            </div>
            <div className="platform__body">
              <div className="platform__name">{name}</div>
              <div className="platform__note">{locale === 'zh' ? noteZh : noteEn}</div>
            </div>
            <div className="platform__arrow">
              <ArrowUpRight size={14} aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const {
    messages: { homepage },
  } = useLocale();

  return (
    <section id="features" className="section">
      <div className="section__head">
        <div className="section__eyebrow">
          <span className="section__num">02</span>
          <span>{homepage.features.eyebrow}</span>
        </div>
        <h2 className="section__title">{homepage.features.title}</h2>
        <p className="section__sub">{homepage.features.subtitle}</p>
      </div>

      <div className="features">
        {homepage.features.items.map((item, index) => {
          const Icon = FEATURE_ICONS[index] ?? CalendarCheck;

          return (
            <article key={item.title} className="feature">
              <div className="feature__head">
                <span className="feature__num">{String(index + 1).padStart(2, '0')}</span>
                <span className="feature__kicker">{item.subtitle}</span>
                <span className="feature__icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
              </div>
              <h3 className="feature__title">{item.title}</h3>
              <p className="feature__body">{item.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Architecture() {
  const {
    locale,
    messages: { homepage },
  } = useLocale();

  return (
    <section id="architecture" className="section section--invert">
      <div className="arch">
        <div className="arch__head">
          <div className="section__eyebrow section__eyebrow--invert">
            <span className="section__num">03</span>
            <span>{homepage.architecture.eyebrow}</span>
          </div>
          <h2 className="section__title section__title--invert">{homepage.architecture.title}</h2>
          <p className="section__sub section__sub--invert">{homepage.architecture.subtitle}</p>

          <div className="arch__diagram" aria-hidden="true">
            <div className="arch__layer arch__layer--top">
              <span>{locale === 'zh' ? '你' : 'You'}</span>
              <span className="arch__chip">WeChat</span>
              <span className="arch__chip">Telegram</span>
              <span className="arch__chip">Slack</span>
            </div>
            <div className="arch__line" />
            <div className="arch__layer arch__layer--mid">
              <span className="arch__pill">Coke gateway</span>
            </div>
            <div className="arch__line" />
            <div className="arch__layer arch__layer--bot">
              <span className="arch__chip arch__chip--brand">openCoke</span>
              <span className="arch__chip arch__chip--brand">GPT</span>
              <span className="arch__chip arch__chip--brand">Claude</span>
              <span className="arch__chip arch__chip--brand">CLI bridge</span>
            </div>
          </div>
        </div>

        <ul className="arch__points">
          {homepage.architecture.points.map((point, index) => (
            <li key={point} className="arch__point">
              <span className="arch__point-num">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <div className="arch__point-title">{point}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Contact() {
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
    <section id="contact" className="section section--flush">
      <div className="contact">
        <div className="contact__inner">
          <div className="section__eyebrow">
            <span className="section__num">04</span>
            <span>{homepage.contact.eyebrow}</span>
          </div>
          <h2 className="contact__title">{homepage.contact.title}</h2>
          <p className="contact__body">{homepage.contact.body}</p>

          <form className="contact__form" onSubmit={handleSubmit}>
            {submitted ? (
              <div className="contact__thanks">
                <Check size={16} style={{ color: 'var(--olive-500)' }} aria-hidden="true" />
                {homepage.contact.thanks}
              </div>
            ) : (
              <>
                <input
                  className="contact__input"
                  type="email"
                  placeholder={homepage.contact.placeholder}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <button type="submit" className="btn btn--primary btn--lg">
                  {homepage.contact.primaryCta}
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                <Link href="/auth/login" className="contact__alt">
                  {homepage.contact.secondaryCta}
                </Link>
              </>
            )}
          </form>

          <p className="contact__note">{homepage.contact.note}</p>
        </div>

        <div className="contact__mark" aria-hidden="true">
          <span className="contact__mark-text">coke</span>
          <span className="contact__mark-dot" />
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
        <Link href="/" className="site-footer__brand brand" aria-label="Coke AI">
          <span className="brand__mark">coke</span>
          <span className="brand__dot" aria-hidden="true" />
        </Link>

        <div className="site-footer__cols">
          <div>
            <div className="site-footer__h">{homepage.footer.productHeading}</div>
            {homepage.footer.productLinks.map((label, index) => (
              <Link key={label} href={FOOTER_LINKS.product[index] ?? '#'}>{label}</Link>
            ))}
          </div>
          <div>
            <div className="site-footer__h">{homepage.footer.accountHeading}</div>
            {homepage.footer.accountLinks.map((label, index) => (
              <Link key={label} href={FOOTER_LINKS.account[index] ?? '#'}>{label}</Link>
            ))}
          </div>
          <div>
            <div className="site-footer__h">{homepage.footer.companyHeading}</div>
            {homepage.footer.companyLinks.map((label, index) => (
              <Link key={label} href={FOOTER_LINKS.company[index] ?? '#'}>{label}</Link>
            ))}
          </div>
        </div>
      </div>

      <div className="site-footer__bar">
        <span>{homepage.footer.copyright}</span>
        <span>{homepage.footer.tagline}</span>
      </div>
    </footer>
  );
}
