'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { storeAuth } from '@/lib/auth';
import { LocaleSwitch } from '@/components/locale-switch';
import { useLocale } from '@/components/locale-provider';
import { getDashboardCopy } from '@/lib/dashboard-copy';
import type { ApiResponse, AuthResult } from '../../../../shared/src/types/api';

export default function Login() {
  const router = useRouter();
  const { locale } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const copy = getDashboardCopy(locale);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await api.post<ApiResponse<AuthResult>>('/auth/login', { email, password });
      if (!res.ok) { setError(copy.login.genericError); return; }
      storeAuth(res.data);
      router.push('/dashboard');
    } finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <div className="absolute right-4 top-4 text-white">
        <LocaleSwitch />
      </div>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Image src="/logo.png" alt="ClawScale" width={32} height={32} className="h-8 w-8" />
          <span className="text-2xl font-semibold text-white">ClawScale</span>
        </div>

        <div className="card p-8">
          <h1 className="text-xl font-semibold text-gray-900 mb-1">{copy.login.title}</h1>
          <p className="text-sm text-gray-500 mb-6">{copy.login.description}</p>

          {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">{copy.login.emailLabel}</label>
              <input id="email" type="email" className="input" placeholder={copy.login.emailPlaceholder}
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="password">{copy.login.passwordLabel}</label>
              <input id="password" type="password" className="input" placeholder={copy.login.passwordPlaceholder}
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} {copy.login.submit}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            {copy.login.noWorkspacePrompt}{' '}
            <Link href="/dashboard/register" className="text-teal-600 hover:underline font-medium">{copy.login.createOne}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
