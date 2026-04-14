'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plus, Zap, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useLocale } from '@/components/locale-provider';
import { getDashboardCopy } from '@/lib/dashboard-copy';
import type { ApiResponse } from '../../../../shared/src/types/api';
import type { Workflow, WorkflowType } from '../../../../shared/src/types/workflow';

export default function Workflows() {
  const me = getUser();
  const { locale } = useLocale();
  const isAdmin = me?.role === 'admin';
  const [rows, setRows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const copy = getDashboardCopy(locale);

  useEffect(() => { load(); }, []);

  function load() {
    api.get<ApiResponse<Workflow[]>>('/api/workflows').then((r) => {
      if (r.ok) setRows(r.data);
      setLoading(false);
    });
  }

  async function handleDelete(id: string) {
    if (!confirm(copy.workflows.confirmDelete)) return;
    await api.delete(`/api/workflows/${id}`);
    setRows((prev) => prev.filter((w) => w.id !== id));
  }

  async function handleToggle(w: Workflow) {
    const res = await api.patch<ApiResponse<Workflow>>(`/api/workflows/${w.id}`, { isActive: !w.isActive });
    if (res.ok) setRows((prev) => prev.map((r) => r.id === w.id ? res.data : r));
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{copy.workflows.title}</h1>
          <p className="text-gray-500 mt-1">{copy.workflows.subtitle}</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {copy.workflows.newWorkflow}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card p-12 text-center">
          <Zap className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{copy.workflows.empty}</p>
          {isAdmin && (
            <button className="btn-primary inline-flex mt-4" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> {copy.workflows.createFirst}
            </button>
          )}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {rows.map((w) => (
            <div key={w.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50">
                <Zap className="h-4 w-4 text-teal-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{w.name}</p>
                <p className="text-xs text-gray-400">{copy.workflows.typeLabels[w.type]}{w.description ? ` · ${w.description}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${w.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                  {w.isActive ? copy.workflows.statuses.active : copy.workflows.statuses.inactive}
                </span>
                {isAdmin && (
                  <>
                    <button onClick={() => handleToggle(w)} className="text-gray-400 hover:text-teal-600 transition-colors text-xs underline">
                      {w.isActive ? copy.workflows.actions.disable : copy.workflows.actions.enable}
                    </button>
                    <button onClick={() => handleDelete(w.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && isAdmin && (
        <CreateWorkflowModal copy={copy.workflows} onClose={() => setCreating(false)} onCreated={(w) => { setRows((p) => [w, ...p]); setCreating(false); }} />
      )}
    </div>
  );
}

function CreateWorkflowModal({
  copy,
  onClose,
  onCreated,
}: {
  copy: ReturnType<typeof getDashboardCopy>['workflows'];
  onClose: () => void;
  onCreated: (w: Workflow) => void;
}) {
  const [form, setForm] = useState({ name: '', type: 'script_js' as WorkflowType, description: '', code: '', webhookUrl: '', appId: '', skillName: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const isScript = form.type.startsWith('script_');
      const config = form.type === 'n8n'
        ? { webhookUrl: form.webhookUrl }
        : form.type === 'pulse_editor'
          ? { appId: form.appId, skillName: form.skillName }
          : {};

      const res = await api.post<ApiResponse<Workflow>>('/api/workflows', {
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        code: isScript ? form.code : undefined,
        config,
      });
      if (!res.ok) { setError(copy.genericError); return; }
      onCreated(res.data);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{copy.modal.title}</h2>
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">{copy.modal.name}</label>
            <input className="input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div>
            <label className="label">{copy.modal.description}</label>
            <input className="input" placeholder={copy.modal.descriptionPlaceholder} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">{copy.modal.type}</label>
            <select className="input" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as WorkflowType }))}>
              {(Object.entries(copy.typeLabels) as [WorkflowType, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          {form.type.startsWith('script_') && (
            <div>
              <label className="label">{copy.modal.scriptCode}</label>
              <textarea className="input font-mono text-xs min-h-[140px] resize-y" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
            </div>
          )}
          {form.type === 'n8n' && (
            <div>
              <label className="label">{copy.modal.webhookUrl}</label>
              <input className="input" placeholder="https://n8n.example.com/webhook/..." value={form.webhookUrl} onChange={(e) => setForm((p) => ({ ...p, webhookUrl: e.target.value }))} required />
            </div>
          )}
          {form.type === 'pulse_editor' && (
            <>
              <div>
                <label className="label">{copy.modal.appId}</label>
                <input className="input" value={form.appId} onChange={(e) => setForm((p) => ({ ...p, appId: e.target.value }))} required />
              </div>
              <div>
                <label className="label">{copy.modal.skillName}</label>
                <input className="input" value={form.skillName} onChange={(e) => setForm((p) => ({ ...p, skillName: e.target.value }))} required />
              </div>
            </>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn">{copy.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {copy.modal.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
