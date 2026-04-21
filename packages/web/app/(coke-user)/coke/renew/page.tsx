'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { getCokeUserToken } from '../../../../lib/coke-user-auth';

export default function RenewPage() {
  const { messages } = useLocale();
  const copy = messages.cokeUserPages.renew;
  const router = useRouter();
  const [error, setError] = useState('');
  const [hasToken] = useState(() => getCokeUserToken() != null);
  const [loading, setLoading] = useState(true);
  const getGenericError = useEffectEvent(() => copy.genericError);

  useEffect(() => {
    if (!hasToken) {
      router.replace('/auth/login?next=/coke/renew');
      return;
    }

    let cancelled = false;

    void cokeUserApi
      .post<ApiResponse<{ url: string }>>('/api/coke/checkout')
      .then((res) => {
        if (cancelled) {
          return;
        }

        if (!res.ok) {
          setError(getGenericError());
          setLoading(false);
          return;
        }

        window.open(res.data.url, '_self');
      })
      .catch(() => {
        if (!cancelled) {
          setError(getGenericError());
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasToken, router]);

  if (!hasToken) {
    return null;
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {error || (loading ? copy.preparing : copy.ready)}
      </p>

      {!loading || error ? (
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/auth/login"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {copy.signIn}
          </Link>
          <Link
            href="/channels/wechat-personal"
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            {copy.backToSetup}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
