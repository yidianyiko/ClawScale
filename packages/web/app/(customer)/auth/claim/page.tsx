'use client';

import { useLocale } from '../../../../components/locale-provider';

export default function ClaimPage() {
  const { messages } = useLocale();
  const copy = messages.customerPages.claim;

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-dashed border-slate-300 bg-white/80 p-8 text-slate-950 shadow-sm">
      <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-500">{copy.eyebrow}</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{copy.description}</p>
    </section>
  );
}
