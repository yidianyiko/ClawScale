import Link from 'next/link';
import { ArrowRight, Bot, ChartNoAxesCombined, MessageSquare, ShieldCheck, Sparkles, Workflow } from 'lucide-react';

import { CokePublicShell } from './coke-public-shell';

const platforms = ['WeChat', 'Telegram', 'DingTalk', 'Lark', 'Slack', 'Discord'];

const features = [
  {
    icon: MessageSquare,
    title: '日程管理',
    subtitle: 'Schedule',
    body: '智能理解上下文，帮助你安排会议、提醒和日常跟进。',
  },
  {
    icon: Sparkles,
    title: '任务规划',
    subtitle: 'Planning',
    body: '把复杂目标拆成更清晰的行动路径，并随着使用不断贴近你的习惯。',
  },
  {
    icon: ChartNoAxesCombined,
    title: '数据分析',
    subtitle: 'Analytics',
    body: '从你的节奏和行为里总结模式，给出可执行的下一步建议。',
  },
  {
    icon: Workflow,
    title: '主动工作流',
    subtitle: 'Proactive Workflows',
    body: '在合适的时间主动提醒、推进事项，而不是等你每次都来询问。',
  },
];

const architecturePoints = [
  'Modular architecture / 模块化架构',
  'AI-driven orchestration / 智能编排',
  'Reliable data persistence / 稳定数据持久化',
  'Privacy-first operation / 隐私优先',
];

export function CokeHomepage() {
  return (
    <CokePublicShell>
      <section className="grid gap-10 py-18 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-teal-300">Evolves With You</p>
          <h1 className="mt-6 text-5xl font-semibold leading-tight text-white sm:text-6xl">
            与您共同成长的 AI 助手
          </h1>
          <p className="mt-4 text-2xl text-slate-200">An AI Partner That Grows With You</p>
          <p className="mt-8 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            Coke AI 不只是工具，更是随着你长期使用而不断变得更懂你的智能伙伴。
            <span className="block text-slate-400">
              Coke AI is more than a tool. It becomes a sharper partner as it learns your rhythm, priorities, and context over time.
            </span>
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/coke/register"
              className="inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-300"
            >
              Register / 注册
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/coke/login"
              className="inline-flex items-center rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              Sign in / 登录
            </Link>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/6 p-6 shadow-2xl shadow-teal-950/20 backdrop-blur">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard value="6+" label="Platforms / 支持平台" />
            <StatCard value="99.9%" label="Uptime / 可用性" />
            <StatCard value="<100ms" label="Latency / 响应时间" />
            <StatCard value="24/7" label="Always On / 全天候" />
          </div>
          <div className="mt-6 rounded-[1.5rem] border border-white/8 bg-slate-950/60 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-teal-400/15 p-3 text-teal-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">One Assistant, All Platforms</p>
                <p className="text-sm text-slate-400">一个助手，全平台覆盖</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              无需在应用之间切换，Coke AI 会出现在你已经在使用的平台里。
              <span className="block text-slate-400">
                No context-switching. Coke AI meets you inside the channels you already rely on.
              </span>
            </p>
          </div>
        </div>
      </section>

      <section id="platforms" className="py-8">
        <SectionHeading
          eyebrow="Platforms / 平台"
          title="Seamlessly integrated across major IM platforms"
          subtitle="覆盖你已经在使用的沟通平台，而不是要求你重新适应一套新的入口。"
        />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((platform) => (
            <div key={platform} className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4 text-slate-100">
              <p className="font-medium">{platform}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="py-10">
        <SectionHeading
          eyebrow="Features / 功能"
          title="Powerful assistance for modern work and life"
          subtitle="从安排事项到主动督促，Coke AI 以更持续的方式参与，而不是只回答一次问题。"
        />
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {features.map(({ icon: Icon, title, subtitle, body }) => (
            <div key={title} className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-300">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-white">
                {title}
                <span className="ml-2 text-base font-medium text-slate-400">{subtitle}</span>
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="architecture" className="grid gap-8 py-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHeading
            eyebrow="Architecture / 架构"
            title="Built on a reliable technical foundation"
            subtitle="公开产品体验和长期运行能力都需要稳定的底层，不只是一个漂亮首页。"
          />
        </div>
        <div className="grid gap-4">
          {architecturePoints.map((point) => (
            <div key={point} className="flex items-start gap-4 rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <div className="mt-1 rounded-full bg-emerald-400/15 p-2 text-emerald-300">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <p className="text-sm leading-7 text-slate-200">{point}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="contact" className="py-10">
        <div className="rounded-[2rem] border border-white/10 bg-white/6 p-8 text-center shadow-2xl shadow-teal-950/20">
          <p className="text-sm uppercase tracking-[0.35em] text-teal-300">Beta / 内测</p>
          <h2 className="mt-5 text-3xl font-semibold text-white sm:text-4xl">
            Ready to experience the future of AI assistance?
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
            加入我们的内测计划，注册后即可进入 Coke 用户流程，验证邮箱并继续绑定你的个人微信通道。
            <span className="block text-slate-400">
              Join the Coke flow with a real account, verify your email, and continue straight into your personal WeChat binding setup.
            </span>
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/coke/register"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
            >
              Join Beta / 注册
            </Link>
            <Link
              href="/coke/login"
              className="inline-flex items-center rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              Existing account / 已有账号
            </Link>
          </div>
        </div>
      </section>
    </CokePublicShell>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <p className="text-sm uppercase tracking-[0.35em] text-teal-300">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">{subtitle}</p>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-slate-950/55 p-5">
      <p className="text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{label}</p>
    </div>
  );
}
