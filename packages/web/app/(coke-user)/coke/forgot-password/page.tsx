'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { cokeUserApi } from '../../../../lib/coke-user-api';

export default function ForgotPasswordPage() {
  const { messages } = useLocale();
  const copy = messages.cokeUserPages.forgotPassword;
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<unknown>>('/api/coke/forgot-password', { email });
      if (!res.ok) {
        setError(copy.genericError);
        return;
      }

      setMessage(copy.success);
    } catch {
      setError(copy.genericError);
    } finally {
      setLoading(false);
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={copy.emailPlaceholder}
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
        {copy.backToSignInPrompt}{' '}
        <Link href="/coke/login" className="font-medium text-slate-950 underline underline-offset-4">
          {copy.backToSignInLink}
        </Link>
      </p>
    </section>
  );
}
