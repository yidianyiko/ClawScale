'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { getCokeUser, storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

interface MessageResponse {
  message?: string;
}

export default function VerifyEmailPage() {
  const { messages } = useLocale();
  const copy = messages.cokeUserPages.verifyEmail;
  const router = useRouter();
  const [enteredToken, setEnteredToken] = useState('');
  const [enteredEmail, setEnteredEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEnteredToken(params.get('token') ?? '');
    setEnteredEmail(params.get('email') ?? getCokeUser()?.email ?? '');
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<CokeAuthResult>>('/api/coke/verify-email', {
        token: enteredToken,
        email: enteredEmail,
      });

      if (!res.ok) {
        setError(copy.genericError);
        return;
      }

      storeCokeUserAuth(res.data);
      setMessage(copy.verifiedMessage);
      router.push(res.data.user.subscription_active === false ? '/coke/renew' : '/coke/bind-wechat');
    } catch {
      setError(copy.genericError);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setMessage('');
    setResending(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<MessageResponse>>('/api/coke/verify-email/resend', {
        email: enteredEmail,
      });

      if (!res.ok) {
        setError(copy.resendGenericError);
        return;
      }

      setMessage(copy.resendSuccessMessage);
    } catch {
      setError(copy.resendGenericError);
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{copy.description}</p>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
            {copy.emailLabel}
          </label>
          <input
            id="email"
            type="email"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={enteredEmail}
            onChange={(e) => setEnteredEmail(e.target.value)}
            placeholder={copy.emailPlaceholder}
            required
          />
        </div>

        <div>
          <label htmlFor="token" className="mb-2 block text-sm font-medium text-slate-700">
            {copy.tokenLabel}
          </label>
          <input
            id="token"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={enteredToken}
            onChange={(e) => setEnteredToken(e.target.value)}
            placeholder={copy.tokenPlaceholder}
            required
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={loading || resending}
        >
          {loading ? copy.submitting : copy.submit}
        </button>
      </form>

      <button
        type="button"
        data-testid="resend-email"
        className="mt-4 w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-950 transition hover:border-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
        onClick={handleResend}
        disabled={loading || resending || enteredEmail.trim() === ''}
      >
        {resending ? copy.resending : copy.resend}
      </button>

      <p className="mt-6 text-sm text-slate-600">
        {copy.backToSignInPrompt}{' '}
        <Link href="/coke/login" className="font-medium text-slate-950 underline underline-offset-4">
          {copy.backToSignInLink}
        </Link>
      </p>
    </section>
  );
}
