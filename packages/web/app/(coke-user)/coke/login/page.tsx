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
    <section className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
      <div className="rounded-[2rem] border border-white/10 bg-white/6 p-8 text-slate-100">
        <p className="text-sm uppercase tracking-[0.35em] text-teal-300">Sign in / 登录</p>
        <h2 className="mt-5 text-3xl font-semibold">Return to your Coke account</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          登录后会继续检查邮箱验证和订阅状态，再把你带回个人微信绑定页。
          <span className="block text-slate-400">
            After sign-in, Coke keeps the existing verification and subscription checks, then routes you back to your personal WeChat setup.
          </span>
        </p>
        <Link href="/" className="mt-6 inline-flex text-sm font-medium text-teal-300 underline underline-offset-4">
          Back to homepage / 返回首页
        </Link>
      </div>

      <div className="rounded-[2rem] bg-white p-8 text-slate-950 shadow-2xl shadow-slate-950/20">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Sign in to Coke</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Enter your email and password to continue your personal Coke flow.
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
              Email / 邮箱
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
              Password / 密码
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
      </div>
    </section>
  );
}
