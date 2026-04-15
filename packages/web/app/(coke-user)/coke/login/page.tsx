'use client';

import { useEffect, type FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

type VerificationRecoveryReason = 'expired' | 'retry' | null;

export default function CokeLoginPage() {
  const { messages } = useLocale();
  const copy = messages.cokeUserPages.login;
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationRecovery, setVerificationRecovery] = useState<VerificationRecoveryReason>(null);
  const [resendMessage, setResendMessage] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const nextEmail = params.get('email');

    if (nextEmail !== null) {
      setEmail(nextEmail);
    }

    const verificationState = params.get('verification');
    setVerificationRecovery(
      verificationState === 'expired' || verificationState === 'retry' ? verificationState : null,
    );
  }, []);

  const verificationRecoveryDescription =
    verificationRecovery === 'retry'
      ? copy.verificationRetryDescription
      : copy.verificationRecoveryDescription;

  function showVerificationRecovery(reason: Exclude<VerificationRecoveryReason, null>) {
    setVerificationRecovery(reason);
    setResendMessage('');
    setResendStatus('idle');
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setStatusMessage('');
    setLoading(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<CokeAuthResult>>('/api/coke/login', {
        email,
        password,
      });

      if (!res.ok) {
        setError(copy.genericError);
        return;
      }

      storeCokeUserAuth(res.data);

      if (res.data.user.status === 'suspended') {
        setError(copy.suspendedError);
        return;
      }

      if (res.data.user.email_verified !== true) {
        setStatusMessage(copy.emailVerificationRequired);
        showVerificationRecovery('expired');
        return;
      }

      if (res.data.user.subscription_active !== true) {
        setStatusMessage(copy.subscriptionRenewalRequired);
        router.push('/coke/renew');
        return;
      }

      setStatusMessage(copy.success);
      const next =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null;
      router.push(next && next.startsWith('/coke/') ? next : '/coke/bind-wechat');
    } catch {
      setError(copy.genericError);
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    if (email.trim() === '') {
      return;
    }

    setResendMessage('');
    setResendStatus('idle');
    setResending(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<unknown>>('/api/coke/verify-email/resend', {
        email,
      });

      if (!res.ok) {
        setResendStatus('error');
        setResendMessage(copy.resendVerificationError);
        return;
      }

      setResendStatus('success');
      setResendMessage(copy.resendVerificationSuccess);
    } catch {
      setResendStatus('error');
      setResendMessage(copy.resendVerificationError);
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
      <div className="rounded-[2rem] border border-white/10 bg-white/6 p-8 text-slate-100">
        <p className="text-sm uppercase tracking-[0.35em] text-teal-300">{copy.eyebrow}</p>
        <h2 className="mt-5 text-3xl font-semibold">{copy.heroTitle}</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          {copy.heroBody}
          <span className="block text-slate-400">{copy.heroSecondaryBody}</span>
        </p>
        <Link href="/" className="mt-6 inline-flex text-sm font-medium text-teal-300 underline underline-offset-4">
          {copy.backToHomepage}
        </Link>
      </div>

      <div className="rounded-[2rem] bg-white p-8 text-slate-950 shadow-2xl shadow-slate-950/20">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{copy.description}</p>

        {verificationRecovery ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p className="font-medium">{copy.verificationRecoveryTitle}</p>
            <p className="mt-2 leading-6">{verificationRecoveryDescription}</p>
            <button
              type="button"
              className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={resending || email.trim() === ''}
              onClick={handleResendVerification}
            >
              {resending ? copy.resendingVerificationEmail : copy.resendVerificationEmail}
            </button>
            {resendMessage ? (
              <p
                className={`mt-3 text-sm ${
                  resendStatus === 'success' ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {resendMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {statusMessage ? <p className="mt-4 text-sm text-slate-600">{statusMessage}</p> : null}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
              {copy.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={copy.emailPlaceholder}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
              {copy.passwordLabel}
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={copy.passwordPlaceholder}
              required
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={loading}
          >
            {loading ? copy.submitting : copy.submit}
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-600">
          {copy.forgotPasswordPrompt}{' '}
          <Link href="/coke/forgot-password" className="font-medium text-slate-950 underline underline-offset-4">
            {copy.forgotPasswordLink}
          </Link>
        </p>

        <p className="mt-3 text-sm text-slate-600">
          {copy.registerPrompt}{' '}
          <Link href="/coke/register" className="font-medium text-slate-950 underline underline-offset-4">
            {copy.registerLink}
          </Link>
        </p>
      </div>
    </section>
  );
}
