'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X, Save, BotMessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { AiBackend, AiBackendType, AiBackendProviderConfig, ApiResponse } from '@clawscale/shared';
import { AI_PROVIDER_LABELS, AI_PROVIDER_TYPES } from '@clawscale/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackendListItem {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BackendFull extends BackendListItem {
  config: AiBackendProviderConfig;
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  type: AiBackendType;
  isActive: boolean;
  config: AiBackendProviderConfig;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'openai',
  isActive: true,
  config: {},
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AiBackendsPage() {
  const me = getUser();
  const isAdmin = me?.role === 'admin';

  const [backends, setBackends] = useState<BackendListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    const res = await api.get<ApiResponse<BackendListItem[]>>('/api/ai-backends');
    if (res.ok) setBackends(res.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }

  async function openEdit(id: string) {
    setFormError('');
    const res = await api.get<ApiResponse<BackendFull>>(`/api/ai-backends/${id}`);
    if (!res.ok) return;
    const b = res.data;
    setForm({ name: b.name, type: b.type as AiBackendType, isActive: b.isActive, config: b.config ?? {} });
    setEditingId(id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  function updateConfig(patch: Partial<AiBackendProviderConfig>) {
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));
  }

  function handleTypeChange(type: AiBackendType) {
    setForm((f) => ({ ...f, type, config: {} }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = { name: form.name, type: form.type, isActive: form.isActive, config: form.config };
      const res = editingId
        ? await api.patch<ApiResponse<BackendFull>>(`/api/ai-backends/${editingId}`, payload)
        : await api.post<ApiResponse<BackendFull>>('/api/ai-backends', payload);
      if (!res.ok) { setFormError(res.error); return; }
      closeForm();
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await api.delete<ApiResponse<null>>(`/api/ai-backends/${id}`);
    setDeletingId(null);
    load();
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
    </div>
  );

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">AI Backends</h1>
          <p className="text-gray-500 mt-1">
            Configure AI providers available to end-users. When a user starts a conversation
            they can choose which backend to use — each backend can serve many users and
            each user can switch between any active backend.
          </p>
        </div>
        {isAdmin && (
          <button className="btn-primary shrink-0" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add backend
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Only admins can manage AI backends.
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{editingId ? 'Edit backend' : 'New backend'}</h2>
            <button onClick={closeForm} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Name <span className="text-gray-400 font-normal">(shown to users)</span></label>
                <input
                  className="input"
                  placeholder="e.g. GPT-4o, Claude, My Local LLM"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Provider</label>
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => handleTypeChange(e.target.value as AiBackendType)}
                >
                  {AI_PROVIDER_TYPES.map((t) => (
                    <option key={t} value={t}>{AI_PROVIDER_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Provider-specific fields */}
            <ProviderFields type={form.type} config={form.config} onChange={updateConfig} />

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-teal-500"
              />
              <label htmlFor="isActive" className="text-sm text-gray-700">Active (visible to end-users)</label>
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingId ? 'Save changes' : 'Create backend'}
              </button>
              <button type="button" className="btn-secondary" onClick={closeForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {backends.length === 0 ? (
        <div className="card p-12 flex flex-col items-center text-center">
          <BotMessageSquare className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No AI backends configured yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Add at least one backend so end-users can start chatting.
          </p>
          {isAdmin && (
            <button className="btn-primary mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add your first backend
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {backends.map((b) => (
            <div key={b.id} className="card px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{b.name}</span>
                  {!b.isActive && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Inactive</span>
                  )}
                </div>
                <p className="text-sm text-gray-400 mt-0.5">
                  {AI_PROVIDER_LABELS[b.type as AiBackendType] ?? b.type}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="text-gray-400 hover:text-gray-700 transition-colors p-1"
                    title="Edit"
                    onClick={() => openEdit(b.id)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Delete"
                    disabled={deletingId === b.id}
                    onClick={() => handleDelete(b.id)}
                  >
                    {deletingId === b.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Provider-specific config fields ───────────────────────────────────────────

function ProviderFields({
  type,
  config,
  onChange,
}: {
  type: AiBackendType;
  config: AiBackendProviderConfig;
  onChange: (patch: Partial<AiBackendProviderConfig>) => void;
}) {
  const inp = (
    field: keyof AiBackendProviderConfig,
    placeholder: string,
    label: string,
    opts?: { type?: string; hint?: string; required?: boolean },
  ) => (
    <div>
      <label className="label">{label}</label>
      <input
        className="input font-mono text-xs"
        type={opts?.type ?? 'text'}
        placeholder={placeholder}
        value={(config[field] as string) ?? ''}
        onChange={(e) => onChange({ [field]: e.target.value })}
        required={opts?.required}
      />
      {opts?.hint && <p className="text-xs text-gray-400 mt-1">{opts.hint}</p>}
    </div>
  );

  if (type === 'openai') return (
    <div className="grid grid-cols-2 gap-4">
      {inp('apiKey', 'sk-...', 'API Key', { type: 'password', required: true })}
      {inp('model', 'gpt-4o-mini', 'Model')}
    </div>
  );

  if (type === 'anthropic') return (
    <div className="grid grid-cols-2 gap-4">
      {inp('apiKey', 'sk-ant-...', 'API Key', { type: 'password', required: true })}
      {inp('model', 'claude-haiku-4-5-20251001', 'Model')}
    </div>
  );

  if (type === 'openrouter') return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {inp('apiKey', 'sk-or-...', 'API Key', { type: 'password', required: true })}
        {inp('model', 'openai/gpt-4o-mini', 'Model')}
      </div>
      {inp('baseUrl', 'https://openrouter.ai/api/v1', 'Base URL (optional)', {
        hint: 'Leave blank to use the default OpenRouter endpoint.',
      })}
    </div>
  );

  if (type === 'openclaw') return (
    <div className="space-y-4">
      {inp('openClawUrl', 'http://localhost:8080', 'OpenClaw URL', {
        required: true,
        hint: 'Base URL of your OpenClaw instance. /v1 is appended automatically.',
      })}
      <div className="grid grid-cols-2 gap-4">
        {inp('apiKey', 'optional', 'API Key (optional)', { type: 'password' })}
        {inp('model', 'default', 'Model (optional)')}
      </div>
    </div>
  );

  if (type === 'pulse') return inp(
    'pulseApiUrl',
    'http://localhost:5000',
    'Pulse API URL',
    { required: true, hint: 'Base URL of the Pulse Editor AI manager. /stream is appended automatically.' },
  );

  if (type === 'custom') return (
    <div className="space-y-4">
      {inp('baseUrl', 'https://your-api/v1', 'Base URL', {
        required: true,
        hint: 'Must expose an OpenAI-compatible /chat/completions endpoint.',
      })}
      <div className="grid grid-cols-2 gap-4">
        {inp('apiKey', 'optional', 'API Key (optional)', { type: 'password' })}
        {inp('model', 'model-name', 'Model')}
      </div>
    </div>
  );

  return null;
}
