'use client';
import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser, clearAuth } from '@/lib/auth';
import { useLocale } from '@/components/locale-provider';
import { getDashboardCopy } from '@/lib/dashboard-copy';
import type { ApiResponse } from '../../../../shared/src/types/api';
import type { Tenant, TenantSettings } from '../../../../shared/src/types/tenant';

export default function Settings() {
  const router = useRouter();
  const me = getUser();
  const { locale } = useLocale();
  const isAdmin = me?.role === 'admin';
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [name, setName] = useState('');
  const [personaName, setPersonaName] = useState('');
  const [personaPrompt, setPersonaPrompt] = useState('');
  const [endUserAccess, setEndUserAccess] = useState<TenantSettings['endUserAccess']>('anonymous');
  const [clawscaleModel, setClawscaleModel] = useState('openai:gpt-5.4-mini');
  const [clawscaleApiKey, setClawscaleApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [clawscaleMultimodal, setClawscaleMultimodal] = useState(false);
  const copy = getDashboardCopy(locale);

  useEffect(() => {
    api.get<ApiResponse<Tenant>>('/api/tenant').then((res) => {
      if (res.ok) {
        const t = res.data;
        setTenant(t); setName(t.name);
        const s = t.settings as TenantSettings;
        setPersonaName(s.personaName ?? copy.settings.persona.namePlaceholder);
        setPersonaPrompt(s.personaPrompt ?? '');
        setEndUserAccess(s.endUserAccess ?? 'anonymous');
        setClawscaleModel(s.clawscale?.llm?.model ?? 'openai:gpt-5.4-mini');
        setApiKeySet(!!s.clawscale?.llm?.apiKey && s.clawscale.llm.apiKey !== '');
        setClawscaleMultimodal(s.clawscale?.llm?.multimodal ?? false);
      }
      setLoading(false);
    });
  }, [copy.settings.persona.namePlaceholder]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSuccess(false); setSaving(true);
    try {
      const res = await api.patch<ApiResponse<Tenant>>('/api/tenant', {
        name,
        settings: {
          personaName, personaPrompt, endUserAccess,
          clawscale: {
            llm: {
              model: clawscaleModel,
              ...(clawscaleApiKey ? { apiKey: clawscaleApiKey } : {}),
              multimodal: clawscaleMultimodal,
            },
          },
        },
      });
      if (!res.ok) { setError(copy.settings.genericError); return; }
      setTenant(res.data); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">{copy.settings.title}</h1>
        <p className="text-gray-500 mt-1">{copy.settings.subtitle}</p>
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          {copy.settings.onlyAdmins}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">{copy.settings.workspace.title}</h2>
          <div className="space-y-4">
            <div>
              <label className="label">{copy.settings.workspace.name}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} required />
            </div>
            <div>
              <label className="label">{copy.settings.workspace.slug}</label>
              <input className="input bg-gray-50" value={tenant?.slug ?? ''} disabled />
              <p className="text-xs text-gray-400 mt-1">{copy.settings.workspace.slugHint}</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">{copy.settings.persona.title}</h2>
          <p className="text-sm text-gray-500 mb-4">{copy.settings.persona.subtitle}</p>
          <div className="space-y-4">
            <div>
              <label className="label">{copy.settings.persona.name}</label>
              <input className="input" placeholder={copy.settings.persona.namePlaceholder} value={personaName} onChange={(e) => setPersonaName(e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">{copy.settings.persona.prompt}</label>
              <textarea className="input min-h-[120px] resize-y font-mono text-xs" placeholder={copy.settings.persona.promptPlaceholder}
                value={personaPrompt} onChange={(e) => setPersonaPrompt(e.target.value)} disabled={!isAdmin} />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">{copy.settings.assistant.title}</h2>
          <p className="text-sm text-gray-500 mb-4">{copy.settings.assistant.subtitle}</p>
          <div className="space-y-4">
            <div>
              <label className="label">{copy.settings.assistant.model}</label>
              <input className="input" placeholder={copy.settings.assistant.modelPlaceholder} value={clawscaleModel} onChange={(e) => setClawscaleModel(e.target.value)} disabled={!isAdmin} />
              <p className="text-xs text-gray-400 mt-1">{copy.settings.assistant.modelHint}</p>
            </div>
            <div>
              <label className="label">{copy.settings.assistant.apiKey}</label>
              <input className="input font-mono text-xs" type="password" placeholder={apiKeySet ? '••••••••••••••••' : copy.settings.assistant.apiKeyPlaceholder} value={clawscaleApiKey} onChange={(e) => setClawscaleApiKey(e.target.value)} disabled={!isAdmin} />
              {apiKeySet && !clawscaleApiKey && <p className="text-xs text-emerald-600 mt-1">{copy.settings.assistant.apiKeySaved}</p>}
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={clawscaleMultimodal} onChange={(e) => setClawscaleMultimodal(e.target.checked)} disabled={!isAdmin} className="mt-0.5" />
              <span>
                <span className="text-sm font-medium text-gray-900">{copy.settings.assistant.enableMultimodal}</span>
                <span className="text-xs text-gray-500 block">{copy.settings.assistant.multimodalHint}</span>
              </span>
            </label>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">{copy.settings.endUserAccess.title}</h2>
          <p className="text-sm text-gray-500 mb-4">{copy.settings.endUserAccess.subtitle}</p>
          <div className="space-y-2">
            {(['anonymous', 'whitelist', 'blacklist'] as const).map((opt) => (
              <label key={opt} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="endUserAccess"
                  value={opt}
                  checked={endUserAccess === opt}
                  onChange={() => setEndUserAccess(opt)}
                  disabled={!isAdmin}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm font-medium text-gray-900">{copy.settings.endUserAccess[opt]}</span>
                  <span className="text-xs text-gray-500 block">
                    {opt === 'anonymous' && copy.settings.endUserAccess.anonymousHint}
                    {opt === 'whitelist' && copy.settings.endUserAccess.whitelistHint}
                    {opt === 'blacklist' && copy.settings.endUserAccess.blacklistHint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-4">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {copy.settings.saveChanges}
            </button>
            {success && <p className="text-sm text-emerald-600 font-medium">{copy.settings.saved}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}
      </form>

      <div className="mt-10 border-t border-red-200 pt-8">
        <div className="card border-red-200 p-6">
          <h2 className="font-semibold text-red-700 mb-1">{copy.settings.dangerZone.title}</h2>
          <p className="text-sm text-gray-500 mb-4">
            {copy.settings.dangerZone.description}
          </p>
          <div className="space-y-3">
            <div>
              <label className="label text-red-700">{copy.settings.dangerZone.confirmLabel}</label>
              <input
                className="input border-red-300 focus:border-red-500 focus:ring-red-500"
                placeholder={copy.settings.dangerZone.confirmPlaceholder}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={deleteConfirm !== copy.settings.dangerZone.confirmValue || deleting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={async () => {
                setDeleting(true);
                setError('');
                try {
                  const res = await api.delete<ApiResponse<null>>('/auth/account');
                  if (!res.ok) { setError(copy.settings.genericError); return; }
                  clearAuth();
                  router.push('/dashboard/login');
                } finally { setDeleting(false); }
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {copy.settings.dangerZone.deleteAccount}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
