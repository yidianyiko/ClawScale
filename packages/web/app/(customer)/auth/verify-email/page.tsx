'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

export default function CustomerVerifyEmailPage() {
  const { messages } = useLocale();
  const copy = messages.cokeUserPages.verifyEmail;
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token')?.trim() ?? '';
    const email = params.get('email')?.trim() ?? '';

    if (!token || !email) {
      router.replace(
        email ? `/auth/login?email=${encodeURIComponent(email)}&verification=expired` : '/auth/login?verification=expired',
      );
      return;
    }

    let cancelled = false;

    async function verifyEmailLink() {
      try {
        const res = await cokeUserApi.post<ApiResponse<CokeAuthResult>>('/api/coke/verify-email', {
          token,
          email,
        });

        if (cancelled) return;

        if (!res.ok) {
          router.replace(`/auth/login?email=${encodeURIComponent(email)}&verification=expired`);
          return;
        }

        storeCokeUserAuth(res.data);
        router.replace(
          res.data.user.subscription_active === false
            ? '/channels/wechat-personal?next=renew'
            : '/channels/wechat-personal',
        );
      } catch {
        if (!cancelled) {
          router.replace(`/auth/login?email=${encodeURIComponent(email)}&verification=retry`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void verifyEmailLink();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {loading ? copy.verifyingDescription : copy.description}
      </p>
    </section>
  );
}
