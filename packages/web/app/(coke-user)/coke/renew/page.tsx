'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '@clawscale/shared';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { getCokeUserToken } from '../../../../lib/coke-user-auth';

export default function RenewPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getCokeUserToken()) {
      router.replace('/coke/login?next=/coke/renew');
      setLoading(false);
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
          setError(res.error ?? 'Unable to start renewal right now.');
          setLoading(false);
          return;
        }

        window.open(res.data.url, '_self');
      })
      .catch(() => {
        if (!cancelled) {
          setError('Unable to start renewal right now.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Renew your access</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {error || (loading ? 'Preparing your renewal checkout...' : 'Return to checkout when you are ready.')}
      </p>

      {!loading || error ? (
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/coke/login"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Sign in
          </Link>
          <Link
            href="/coke/bind-wechat"
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            Back to setup
          </Link>
        </div>
      ) : null}
    </section>
  );
}
