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

export default function Register() {
  const router = useRouter();
  const { locale } = useLocale();
  const [form, setForm] = useState({ tenantName: '', tenantSlug: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const copy = getDashboardCopy(locale);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        if (key === 'tenantName') {
          next.tenantSlug = value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 48);
        }
        return next;
      });
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await api.post<ApiResponse<AuthResult>>('/auth/register', form);
      if (!res.ok) { setError(copy.register.genericError); return; }
      storeAuth(res.data);
      router.push('/dashboard');
    } finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-12">
      <div className="absolute right-4 top-4 text-white">
        <LocaleSwitch />
      </div>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Image src="/logo.png" alt="ClawScale" width={32} height={32} className="h-8 w-8" />
          <span className="text-2xl font-semibold text-white">ClawScale</span>
        </div>

        <div className="card p-8">
          <h1 className="text-xl font-semibold text-gray-900 mb-1">{copy.register.title}</h1>
          <p className="text-sm text-gray-500 mb-6">{copy.register.description}</p>

          {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="tenantName">{copy.register.workspaceNameLabel}</label>
              <input id="tenantName" className="input" placeholder={copy.register.workspaceNamePlaceholder} value={form.tenantName} onChange={set('tenantName')} required />
            </div>
            <div>
              <label className="label" htmlFor="tenantSlug">{copy.register.workspaceUrlLabel}</label>
              <div className="flex items-center rounded-lg border border-gray-200 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500 bg-white overflow-hidden">
                <span className="pl-3 text-sm text-gray-400 select-none whitespace-nowrap">{copy.register.workspaceUrlPrefix}</span>
                <input id="tenantSlug" className="flex-1 px-1 py-2 text-sm outline-none bg-transparent"
                  placeholder={copy.register.workspaceUrlPlaceholder} value={form.tenantSlug} onChange={set('tenantSlug')}
                  pattern="[a-z0-9-]+" title={copy.register.workspaceUrlTitle} required />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="name">{copy.register.yourNameLabel}</label>
              <input id="name" className="input" placeholder={copy.register.yourNamePlaceholder} value={form.name} onChange={set('name')} required />
            </div>
            <div>
              <label className="label" htmlFor="email">{copy.register.emailLabel}</label>
              <input id="email" type="email" className="input" placeholder={copy.register.emailPlaceholder} value={form.email} onChange={set('email')} required />
            </div>
            <div>
              <label className="label" htmlFor="password">{copy.register.passwordLabel}</label>
              <input id="password" type="password" className="input" placeholder={copy.register.passwordPlaceholder} value={form.password} onChange={set('password')} minLength={8} required />
            </div>
            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} {copy.register.submit}
            </button>
          </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {copy.register.existingWorkspacePrompt}{' '}
          <Link href="/dashboard/login" className="text-teal-600 hover:underline font-medium">{copy.register.signIn}</Link>
        </p>
        </div>

        <p className="mt-4 text-center text-xs text-white/30">{copy.register.footer}</p>
      </div>
    </div>
  );
}
