'use client';

import Link from 'next/link';

import { useLocale } from '../../../components/locale-provider';

export default function CustomerChannelsPage() {
  const { messages } = useLocale();
  const copy = messages.customerPages.channelsIndex;

  return (
    <section className="mx-auto max-w-4xl space-y-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-500">{copy.eyebrow}</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{copy.description}</p>
      </div>

      <div className="grid gap-4">
        <Link
          href="/channels/wechat-personal"
          className="rounded-3xl border border-slate-200 bg-slate-50 p-6 transition hover:border-slate-950 hover:bg-white"
        >
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">{copy.wechatPersonalTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{copy.wechatPersonalDescription}</p>
        </Link>
      </div>
    </section>
  );
}
