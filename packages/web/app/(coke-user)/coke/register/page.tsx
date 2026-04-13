'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '@clawscale/shared';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

export default function CokeRegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<CokeAuthResult>>('/api/coke/register', {
        displayName,
        email,
        password,
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      storeCokeUserAuth(res.data);
      router.push('/coke/verify-email');
    } catch {
      setError('Unable to create your account right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
      <div className="rounded-[2rem] border border-white/10 bg-white/6 p-8 text-slate-100">
        <p className="text-sm uppercase tracking-[0.35em] text-teal-300">Register / 注册</p>
        <h2 className="mt-5 text-3xl font-semibold">Create your Coke account</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          注册完成后你会先收到邮箱验证，然后继续进入个人微信绑定流程。
          <span className="block text-slate-400">
            Registration leads into email verification first, then the personal WeChat channel setup you already use.
          </span>
        </p>
        <Link href="/" className="mt-6 inline-flex text-sm font-medium text-teal-300 underline underline-offset-4">
          Back to homepage / 返回首页
        </Link>
      </div>

      <div className="rounded-[2rem] bg-white p-8 text-slate-950 shadow-2xl shadow-slate-950/20">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Create your Coke account</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Register here, verify your email, and continue into personal channel setup.
        </p>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="displayName" className="mb-2 block text-sm font-medium text-slate-700">
              Display name / 昵称
            </label>
            <input
              id="displayName"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alice"
              required
            />
          </div>

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
              placeholder="Create a password"
              minLength={8}
              required
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Coke account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-600">
          Already registered?{' '}
          <Link href="/coke/login" className="font-medium text-slate-950 underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </section>
  );
}
