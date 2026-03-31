'use client';
import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { ApiResponse, Tenant, TenantSettings } from '@clawscale/shared';

export default function Settings() {
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [personaName, setPersonaName] = useState('');
  const [personaPrompt, setPersonaPrompt] = useState('');
  const [endUserAccess, setEndUserAccess] = useState<TenantSettings['endUserAccess']>('anonymous');

  useEffect(() => {
    api.get<ApiResponse<Tenant>>('/api/tenant').then((res) => {
      if (res.ok) {
        const t = res.data;
        setTenant(t); setName(t.name);
        const s = t.settings as TenantSettings;
        setPersonaName(s.personaName ?? 'Assistant');
        setPersonaPrompt(s.personaPrompt ?? '');
        setEndUserAccess(s.endUserAccess ?? 'anonymous');
      }
      setLoading(false);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSuccess(false); setSaving(true);
    try {
      const res = await api.patch<ApiResponse<Tenant>>('/api/tenant', {
        name,
        settings: { personaName, personaPrompt, endUserAccess },
      });
      if (!res.ok) { setError(res.error); return; }
      setTenant(res.data); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure your workspace and AI persona.</p>
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Only admins can edit workspace settings.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Workspace</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Workspace name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} required />
            </div>
            <div>
              <label className="label">Workspace slug</label>
              <input className="input bg-gray-50" value={tenant?.slug ?? ''} disabled />
              <p className="text-xs text-gray-400 mt-1">Slug cannot be changed after creation.</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">AI Persona</h2>
          <p className="text-sm text-gray-500 mb-4">How the bot presents itself to end-users.</p>
          <div className="space-y-4">
            <div>
              <label className="label">Persona name</label>
              <input className="input" placeholder="Assistant" value={personaName} onChange={(e) => setPersonaName(e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">System prompt</label>
              <textarea className="input min-h-[120px] resize-y font-mono text-xs" placeholder="You are a helpful assistant for Acme Corp..."
                value={personaPrompt} onChange={(e) => setPersonaPrompt(e.target.value)} disabled={!isAdmin} />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">End-User Access</h2>
          <p className="text-sm text-gray-500 mb-4">Control who can interact with your bot.</p>
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
                  <span className="text-sm font-medium text-gray-900 capitalize">{opt}</span>
                  <span className="text-xs text-gray-500 block">
                    {opt === 'anonymous' && 'Anyone who messages the bot can use it.'}
                    {opt === 'whitelist' && 'Only users on the allow-list can interact.'}
                    {opt === 'blacklist' && 'Everyone except users on the block-list can interact.'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-4">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </button>
            {success && <p className="text-sm text-emerald-600 font-medium">Saved!</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}
      </form>
    </div>
  );
}
