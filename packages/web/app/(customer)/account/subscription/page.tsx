'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';

import { useLocale } from '../../../../components/locale-provider';
import { customerApi } from '../../../../lib/customer-api';

type SubscriptionSnapshot = {
  accountStatus: 'normal' | 'suspended';
  emailVerified: boolean;
  subscriptionActive: boolean;
  subscriptionExpiresAt: string | null;
  accountAccessAllowed: boolean;
  accountAccessDeniedReason: string | null;
  renewalUrl: string;
};

type PageMode = 'checkout' | 'success' | 'cancel';

function resolvePageMode(value: string | null): PageMode {
  if (value === 'success') {
    return 'success';
  }

  if (value === 'cancel') {
    return 'cancel';
  }

  return 'checkout';
}

function formatExpiry(value: string | null, locale: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function CustomerSubscriptionPageContent() {
  const { locale, messages } = useLocale();
  const renewCopy = messages.cokeUserPages.renew;
  const successCopy = messages.cokeUserPages.paymentSuccess;
  const cancelCopy = messages.cokeUserPages.paymentCancel;
  const copy = messages.customerPages.bindWechat.blocked;
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = resolvePageMode(searchParams.get('status'));
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const [loading, setLoading] = useState(mode !== 'cancel');
  const [error, setError] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const loadModeRef = useRef<PageMode | null>(null);

  useEffect(() => {
    if (mode === 'cancel') {
      setLoading(false);
      return;
    }

    if (loadModeRef.current === mode) {
      return;
    }

    loadModeRef.current = mode;

    let cancelled = false;

    async function loadSubscription() {
      try {
        const res = await customerApi.get<ApiResponse<SubscriptionSnapshot>>('/api/customer/subscription');

        if (cancelled) {
          return;
        }

        if (!res.ok) {
          router.replace('/auth/login?next=/account/subscription');
          return;
        }

        setSnapshot(res.data);
      } catch {
        if (!cancelled) {
          setError(renewCopy.genericError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSubscription();

    return () => {
      cancelled = true;
    };
  }, [mode, renewCopy.genericError, router]);

  async function handleCheckout() {
    setCheckoutLoading(true);
    setError('');

    try {
      const res = await customerApi.post<ApiResponse<{ url: string }>>('/api/customer/subscription/checkout');
      if (!res.ok) {
        setError(renewCopy.genericError);
        return;
      }

      window.open(res.data.url, '_self');
    } catch {
      setError(renewCopy.genericError);
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (mode === 'success') {
    const successReadyForSetup = snapshot?.subscriptionActive === true;

    return (
      <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{successCopy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{successCopy.description}</p>
        {loading ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">Refreshing your subscription status...</p>
        ) : error ? (
          <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={successReadyForSetup ? '/channels/wechat-personal' : '/account/subscription'}
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {successReadyForSetup ? successCopy.primaryCta : successCopy.secondaryCta}
          </Link>
          {successReadyForSetup ? (
            <Link
              href="/account/subscription"
              className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
            >
              {successCopy.secondaryCta}
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  if (mode === 'cancel') {
    return (
      <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{cancelCopy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{cancelCopy.description}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/account/subscription"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {cancelCopy.primaryCta}
          </Link>
          <Link
            href="/channels/wechat-personal"
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            {cancelCopy.secondaryCta}
          </Link>
        </div>
      </section>
    );
  }

  const expiry = formatExpiry(snapshot?.subscriptionExpiresAt ?? null, locale === 'zh' ? 'zh-CN' : 'en-US');
  const needsRenewal = snapshot?.subscriptionActive !== true;
  const canStartCheckout =
    needsRenewal &&
    (snapshot?.accountAccessAllowed === true || snapshot?.accountAccessDeniedReason === 'subscription_required');
  const mustVerifyEmail = snapshot?.accountAccessDeniedReason === 'email_not_verified';

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{renewCopy.title}</h1>

      {loading ? (
        <p className="mt-3 text-sm leading-6 text-slate-600">Loading subscription status...</p>
      ) : error ? (
        <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p>
      ) : snapshot ? (
        <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
          <p>
            {snapshot.subscriptionActive ? 'Subscription is active.' : 'Subscription renewal is required.'}
            {expiry ? ` Expires ${expiry}.` : ''}
          </p>
          <p>
            {snapshot.emailVerified
              ? 'Email is verified.'
              : 'Email verification is still required before checkout is available.'}
          </p>
          <p>
            {snapshot.accountStatus === 'suspended'
              ? 'The customer account is suspended.'
              : 'The customer account is active.'}
          </p>
        </div>
      ) : null}

      {!loading && !error && snapshot ? (
        <div className="mt-8 flex flex-wrap gap-3">
          {canStartCheckout ? (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checkoutLoading ? 'Starting checkout...' : copy.renewSubscription}
            </button>
          ) : null}
          {mustVerifyEmail ? (
            <Link
              href="/auth/verify-email"
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              {copy.verifyEmail}
            </Link>
          ) : null}
          <Link
            href="/channels/wechat-personal"
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            {renewCopy.backToSetup}
          </Link>
        </div>
      ) : null}

      {checkoutLoading ? <p className="mt-4 text-sm text-slate-500">Opening checkout…</p> : null}
    </section>
  );
}

export default function CustomerSubscriptionPage() {
  return (
    <Suspense fallback={null}>
      <CustomerSubscriptionPageContent />
    </Suspense>
  );
}
