'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';
import { storeCokeUserAuth, type CokeAuthResult } from '../../../../lib/coke-user-auth';

export default function CustomerRegisterPage() {
  const { messages } = useLocale();
  const copy = messages.customerPages.register;
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
        setError(copy.genericError);
        return;
      }

      storeCokeUserAuth(res.data);
      router.push('/auth/verify-email');
    } catch {
      setError(copy.genericError);
    } finally {
      setLoading(false);
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

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="displayName" className="mb-2 block text-sm font-medium text-slate-700">
              {copy.displayNameLabel}
            </label>
            <input
              id="displayName"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={copy.displayNamePlaceholder}
              required
            />
          </div>

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
              minLength={8}
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
          {copy.signInPrompt}{' '}
          <Link href="/auth/login" className="font-medium text-slate-950 underline underline-offset-4">
            {copy.signInLink}
          </Link>
        </p>
      </div>
    </section>
  );
}
