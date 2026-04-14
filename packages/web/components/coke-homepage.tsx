'use client';

import Link from 'next/link';
import { ArrowRight, Bot, ChartNoAxesCombined, MessageSquare, ShieldCheck, Sparkles, Workflow } from 'lucide-react';

import { CokePublicShell } from './coke-public-shell';
import { useLocale } from './locale-provider';

const featureIcons = [MessageSquare, Sparkles, ChartNoAxesCombined, Workflow] as const;

export function CokeHomepage() {
  const { messages } = useLocale();

  return (
    <CokePublicShell>
      <section className="grid gap-10 py-18 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-teal-300">{messages.homepage.hero.eyebrow}</p>
          <h1 className="mt-6 text-5xl font-semibold leading-tight text-white sm:text-6xl">
            {messages.homepage.hero.title}
          </h1>
          <p className="mt-4 text-2xl text-slate-200">{messages.homepage.hero.subtitle}</p>
          <p className="mt-8 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            {messages.homepage.hero.body}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/coke/register"
              className="inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-300"
            >
              {messages.homepage.hero.primaryCta}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/coke/login"
              className="inline-flex items-center rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              {messages.homepage.hero.secondaryCta}
            </Link>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/6 p-6 shadow-2xl shadow-teal-950/20 backdrop-blur">
          <div className="grid gap-4 sm:grid-cols-2">
            {messages.homepage.stats.map((stat) => (
              <StatCard key={stat.label} value={stat.value} label={stat.label} />
            ))}
          </div>
          <div className="mt-6 rounded-[1.5rem] border border-white/8 bg-slate-950/60 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-teal-400/15 p-3 text-teal-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{messages.homepage.spotlight.title}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-300">{messages.homepage.spotlight.body}</p>
          </div>
        </div>
      </section>

      <section id="platforms" className="py-8">
        <SectionHeading
          eyebrow={messages.homepage.platforms.eyebrow}
          title={messages.homepage.platforms.title}
          subtitle={messages.homepage.platforms.subtitle}
        />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {messages.homepage.platforms.items.map((platform) => (
            <div key={platform} className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4 text-slate-100">
              <p className="font-medium">{platform}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="py-10">
        <SectionHeading
          eyebrow={messages.homepage.features.eyebrow}
          title={messages.homepage.features.title}
          subtitle={messages.homepage.features.subtitle}
        />
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {messages.homepage.features.items.map(({ title, subtitle, body }, index) => {
            const Icon = featureIcons[index] ?? MessageSquare;

            return (
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
            );
          })}
        </div>
      </section>

      <section id="architecture" className="grid gap-8 py-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHeading
            eyebrow={messages.homepage.architecture.eyebrow}
            title={messages.homepage.architecture.title}
            subtitle={messages.homepage.architecture.subtitle}
          />
        </div>
        <div className="grid gap-4">
          {messages.homepage.architecture.points.map((point) => (
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
          <p className="text-sm uppercase tracking-[0.35em] text-teal-300">{messages.homepage.contact.eyebrow}</p>
          <h2 className="mt-5 text-3xl font-semibold text-white sm:text-4xl">
            {messages.homepage.contact.title}
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
            {messages.homepage.contact.body}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/coke/register"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
            >
              {messages.homepage.contact.primaryCta}
            </Link>
            <Link
              href="/coke/login"
              className="inline-flex items-center rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              {messages.homepage.contact.secondaryCta}
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
