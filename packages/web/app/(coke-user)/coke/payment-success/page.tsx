'use client';

import Link from 'next/link';
import { useLocale } from '../../../../components/locale-provider';

export default function PaymentSuccessPage() {
  const { messages } = useLocale();
  const copy = messages.cokeUserPages.paymentSuccess;

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{copy.description}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/channels/wechat-personal"
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          {copy.primaryCta}
        </Link>
        <Link
          href="/coke/renew"
          className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
        >
          {copy.secondaryCta}
        </Link>
      </div>
    </section>
  );
}
