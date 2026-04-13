'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '@clawscale/shared';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

interface MessageResponse {
  message?: string;
}

const RESEND_SUCCESS_MESSAGE = 'If the account exists, a verification email has been sent.';

export default function VerifyEmailPage() {
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
    setEnteredEmail(params.get('email') ?? '');
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
        setError(res.error);
        return;
      }

      storeCokeUserAuth(res.data);
      setMessage('Email verified.');
      router.push(res.data.user.subscription_active === false ? '/coke/renew' : '/coke/bind-wechat');
    } catch {
      setError('Unable to verify your email right now.');
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
        setError(res.error);
        return;
      }

      setMessage(res.data?.message ?? RESEND_SUCCESS_MESSAGE);
    } catch {
      setError('Unable to resend the verification email right now.');
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Verify your email</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Use the link from your inbox, or paste the verification token here to finish account setup.
      </p>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={enteredEmail}
            onChange={(e) => setEnteredEmail(e.target.value)}
            placeholder="alice@example.com"
            required
          />
        </div>

        <div>
          <label htmlFor="token" className="mb-2 block text-sm font-medium text-slate-700">
            Verification token
          </label>
          <input
            id="token"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={enteredToken}
            onChange={(e) => setEnteredToken(e.target.value)}
            placeholder="Paste the token from your email"
            required
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={loading || resending}
        >
          {loading ? 'Verifying...' : 'Verify email'}
        </button>
      </form>

      <button
        type="button"
        data-testid="resend-email"
        className="mt-4 w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-950 transition hover:border-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
        onClick={handleResend}
        disabled={loading || resending || enteredEmail.trim() === ''}
      >
        {resending ? 'Sending...' : 'Resend verification email'}
      </button>

      <p className="mt-6 text-sm text-slate-600">
        Need to sign in instead?{' '}
        <Link href="/coke/login" className="font-medium text-slate-950 underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </section>
  );
}
