'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import { customerApi } from '../../../../lib/customer-api';
import { storeCustomerAuth, type CustomerAuthResult } from '../../../../lib/customer-auth';

export default function ClaimPage() {
  const { messages } = useLocale();
  const copy = messages.customerPages.claim;
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextToken = params.get('token') ?? '';
    setToken(nextToken);

    if (!nextToken) {
      return;
    }

    params.delete('token');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(copy.mismatchError);
      return;
    }

    setLoading(true);

    try {
      const res = await customerApi.post<ApiResponse<CustomerAuthResult>>('/api/auth/claim', {
        token,
        password,
      });

      if (!res.ok) {
        setError(
          res.error === 'invalid_or_expired_token'
            ? copy.invalidOrExpiredError
            : res.error === 'email_already_exists'
              ? copy.emailAlreadyExistsError
              : copy.genericError,
        );
        return;
      }

      storeCustomerAuth(res.data);
      router.push('/channels/wechat-personal');
    } catch {
      setError(copy.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-500">{copy.eyebrow}</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{copy.description}</p>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="token" className="mb-2 block text-sm font-medium text-slate-700">
            {copy.tokenLabel}
          </label>
          <input
            id="token"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={copy.tokenPlaceholder}
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
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-slate-700">
            {copy.confirmPasswordLabel}
          </label>
          <input
            id="confirmPassword"
            type="password"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
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
    </section>
  );
}
