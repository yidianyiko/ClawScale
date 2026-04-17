'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { getCokeUser, storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

type RecoveryReason = 'manual' | 'expired' | 'retry';

export default function CustomerVerifyEmailPage() {
  const { messages } = useLocale();
  const copy = messages.customerPages.verifyEmail;
  const loginCopy = messages.customerPages.login;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [recoveryReason, setRecoveryReason] = useState<RecoveryReason | null>(null);
  const [resendMessage, setResendMessage] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token')?.trim() ?? '';
    const queryEmail = params.get('email')?.trim() ?? '';
    const storedEmail = getCokeUser()?.email?.trim() ?? '';
    const recoveryEmail = queryEmail || storedEmail;

    if (!token || !queryEmail) {
      setEmail(recoveryEmail);
      setRecoveryReason(token || queryEmail ? 'expired' : 'manual');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function verifyEmailLink() {
      try {
        const res = await cokeUserApi.post<ApiResponse<CokeAuthResult>>('/api/coke/verify-email', {
          token,
          email: queryEmail,
        });

        if (cancelled) return;

        if (!res.ok) {
          router.replace(`/auth/login?email=${encodeURIComponent(queryEmail)}&verification=expired`);
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
          router.replace(`/auth/login?email=${encodeURIComponent(queryEmail)}&verification=retry`);
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

  async function handleResendVerification() {
    const nextEmail = email.trim();
    if (nextEmail === '') {
      return;
    }

    setResendMessage('');
    setResendStatus('idle');
    setResending(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<unknown>>('/api/coke/verify-email/resend', {
        email: nextEmail,
      });

      if (!res.ok) {
        setResendStatus('error');
        setResendMessage(loginCopy.resendVerificationError);
        return;
      }

      setResendStatus('success');
      setResendMessage(loginCopy.resendVerificationSuccess);
      setRecoveryReason('manual');
    } catch {
      setResendStatus('error');
      setResendMessage(loginCopy.resendVerificationError);
    } finally {
      setResending(false);
    }
  }

  const isRecoveryMode = recoveryReason != null;
  const recoveryDescription =
    recoveryReason === 'retry'
      ? loginCopy.verificationRetryDescription
      : recoveryReason === 'expired'
        ? loginCopy.verificationRecoveryDescription
        : copy.description;

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {loading && !isRecoveryMode ? copy.verifyingDescription : copy.description}
      </p>

      {isRecoveryMode ? (
        <div className="mt-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p className="font-medium">{loginCopy.verificationRecoveryTitle}</p>
            <p className="mt-2 leading-6">{recoveryDescription}</p>
          </div>

          <div className="mt-6">
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
              {loginCopy.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={loginCopy.emailPlaceholder}
              required
            />
          </div>

          <button
            type="button"
            className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={resending || email.trim() === ''}
            onClick={handleResendVerification}
          >
            {resending ? loginCopy.resendingVerificationEmail : loginCopy.resendVerificationEmail}
          </button>

          {resendMessage ? (
            <p className={`mt-3 text-sm ${resendStatus === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>
              {resendMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
