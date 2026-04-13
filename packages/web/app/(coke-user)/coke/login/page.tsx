'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '@clawscale/shared';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

export default function CokeLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);

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
        setError(res.error);
        return;
      }

      storeCokeUserAuth(res.data);

      if (res.data.user.status === 'suspended') {
        setError('Your Coke account is suspended.');
        return;
      }

      if (res.data.user.email_verified !== true) {
        setStatusMessage('Email verification is required.');
        router.push('/coke/verify-email');
        return;
      }

      if (res.data.user.subscription_active !== true) {
        setStatusMessage('Subscription renewal is required.');
        router.push('/coke/renew');
        return;
      }

      setStatusMessage('Sign-in succeeded.');
      const next =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null;
      router.push(next && next.startsWith('/coke/') ? next : '/coke/bind-wechat');
    } catch {
      setError('Unable to sign in right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Sign in to Coke</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Sign in on the website first, then manage the personal WeChat channel attached to this account.
      </p>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {statusMessage ? <p className="mt-4 text-sm text-slate-600">{statusMessage}</p> : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@example.com"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign in to Coke'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Forgot your password?{' '}
        <Link href="/coke/forgot-password" className="font-medium text-slate-950 underline underline-offset-4">
          Reset it
        </Link>
      </p>

      <p className="mt-3 text-sm text-slate-600">
        Need an account?{' '}
        <Link href="/coke/register" className="font-medium text-slate-950 underline underline-offset-4">
          Create one
        </Link>
      </p>
    </section>
  );
}
