'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ApiResponse } from '@clawscale/shared';
import { useRouter } from 'next/navigation';
import { cokeUserApi } from '../../../../lib/coke-user-api';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [enteredToken, setEnteredToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEnteredToken(params.get('token') ?? '');
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const res = await cokeUserApi.post<ApiResponse<unknown>>('/api/coke/reset-password', {
        token: enteredToken,
        password,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }

      setMessage('Password reset complete.');
      router.push('/coke/login');
    } catch {
      setError('Unable to reset your password right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Reset your password</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Paste the reset token from your email and choose a new password.
      </p>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="token" className="mb-2 block text-sm font-medium text-slate-700">
            Reset token
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

        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            id="password"
            type="password"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Reset password'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Need to start over?{' '}
        <Link href="/coke/forgot-password" className="font-medium text-slate-950 underline underline-offset-4">
          Request a new reset link
        </Link>
      </p>
    </section>
  );
}
