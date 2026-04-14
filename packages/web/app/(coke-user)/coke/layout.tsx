'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { LocaleSwitch } from '../../../components/locale-switch';
import { useLocale } from '../../../components/locale-provider';

export default function CokeUserLayout({ children }: { children: ReactNode }) {
  const { messages } = useLocale();
  const copy = messages.cokeUserLayout;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_rgba(10,17,29,0.98)_42%,_#050814_100%)] text-white">
      <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold tracking-[0.2em]">
              CK
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight">{copy.brandName}</p>
              <p className="text-xs text-slate-400">{copy.brandTagline}</p>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <nav className="text-sm text-slate-400">{copy.navLabel}</nav>
            <LocaleSwitch />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-12">
        <section className="grid gap-8 pb-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="rounded-[2rem] border border-white/10 bg-white/6 p-8 shadow-2xl shadow-teal-950/20">
            <p className="text-sm uppercase tracking-[0.35em] text-teal-300">{copy.eyebrow}</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white">{copy.title}</h1>
            <p className="mt-4 text-base leading-7 text-slate-300">
              {copy.body}
              <span className="block text-slate-400">{copy.secondaryBody}</span>
            </p>
          </div>
          <div>{children}</div>
        </section>
      </main>
    </div>
  );
}
