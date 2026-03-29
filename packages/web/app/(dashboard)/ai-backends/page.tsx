'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X, Save, BotMessageSquare, Star, StarOff, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { AiBackendType, AiBackendProviderConfig, ApiResponse, Tenant, ClawScaleAgentSettings } from '@clawscale/shared';
import { AI_PROVIDER_LABELS, AI_PROVIDER_TYPES } from '@clawscale/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackendListItem {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BackendFull extends BackendListItem {
  config: AiBackendProviderConfig;
}

interface FormState {
  name: string;
  type: AiBackendType;
  isActive: boolean;
  isDefault: boolean;
  config: AiBackendProviderConfig;
}

const EMPTY_FORM: FormState = { name: '', type: 'openai', isActive: true, isDefault: false, config: {} };

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiBackendsPage() {
  const me = getUser();
  const isAdmin = me?.role === 'admin';

  // AI Backends state
  const [backends, setBackends] = useState<BackendListItem[]>([]);
  const [backendsLoading, setBackendsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ClawScale agent settings state (lives in tenant settings)
  const [clawscale, setClawscale] = useState<ClawScaleAgentSettings>({});
  const [clawscaleForm, setClawscaleForm] = useState<ClawScaleAgentSettings>({});
  const [editingClawscale, setEditingClawscale] = useState(false);
  const [savingClawscale, setSavingClawscale] = useState(false);
  const [clawscaleError, setClawscaleError] = useState('');

  async function loadBackends() {
    const res = await api.get<ApiResponse<BackendListItem[]>>('/api/ai-backends');
    if (res.ok) setBackends(res.data);
    setBackendsLoading(false);
  }

  async function loadTenant() {
    const res = await api.get<ApiResponse<Tenant>>('/api/tenant');
    if (res.ok) {
      const cfg = (res.data.settings as { clawscale?: ClawScaleAgentSettings }).clawscale ?? {};
      setClawscale(cfg);
      setClawscaleForm(cfg);
    }
  }

  useEffect(() => { loadBackends(); loadTenant(); }, []);

  // ── Backend CRUD ─────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true);
  }

  async function openEdit(id: string) {
    setFormError('');
    const res = await api.get<ApiResponse<BackendFull>>(`/api/ai-backends/${id}`);
    if (!res.ok) return;
    const b = res.data;
    setForm({ name: b.name, type: b.type as AiBackendType, isActive: b.isActive, isDefault: b.isDefault, config: b.config ?? {} });
    setEditingId(id); setShowForm(true);
  }

  function closeForm() {
    setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); setFormError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      let res: ApiResponse<BackendFull>;
      if (editingId) {
        res = await api.patch<ApiResponse<BackendFull>>(`/api/ai-backends/${editingId}`, {
          name: form.name, type: form.type, isActive: form.isActive,
          isDefault: form.isDefault, config: form.config,
        });
      } else {
        res = await api.post<ApiResponse<BackendFull>>('/api/ai-backends', {
          name: form.name, type: form.type, isActive: form.isActive,
          isDefault: form.isDefault, config: form.config,
        });
      }
      if (!res.ok) { setFormError(res.error); return; }
      closeForm(); loadBackends();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await api.delete<ApiResponse<null>>(`/api/ai-backends/${id}`);
    setDeletingId(null); loadBackends();
  }

  async function toggleDefault(b: BackendListItem) {
    await api.patch<ApiResponse<BackendFull>>(`/api/ai-backends/${b.id}`, { isDefault: !b.isDefault });
    loadBackends();
  }

  // ── ClawScale settings ────────────────────────────────────────────────────────

  async function saveClawscale(e: React.FormEvent) {
    e.preventDefault();
    setClawscaleError('');
    setSavingClawscale(true);
    try {
      const res = await api.patch<ApiResponse<Tenant>>('/api/tenant', {
        settings: { clawscale: clawscaleForm },
      });
      if (!res.ok) { setClawscaleError((res as { error: string }).error); return; }
      const cfg = (res.data.settings as { clawscale?: ClawScaleAgentSettings }).clawscale ?? {};
      setClawscale(cfg); setClawscaleForm(cfg);
      setEditingClawscale(false);
    } finally { setSavingClawscale(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">AI Backends</h1>
        <p className="text-gray-500 mt-1">
          ClawScale greets users and routes them to a backend. Configure the orchestrator below,
          then add the AI backends users can choose from.
        </p>
      </div>

      {!isAdmin && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Only admins can manage AI backends.
        </div>
      )}

      {/* ── ClawScale Orchestrator ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">ClawScale Orchestrator</h2>
        <div className="card px-5 py-4">
          {!editingClawscale ? (
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <BotMessageSquare className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{clawscale.name || 'ClawScale Assistant'}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 font-medium">Built-in</span>
                  {clawscale.isActive === false && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Disabled</span>
                  )}
                </div>
                <p className="text-sm text-gray-400 mt-0.5">
                  Greets users, answers ClawScale questions, and routes to regular backends.
                </p>
                <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                  <Lock className="h-3 w-3" />
                  <span>Selection prompt is locked — name, visibility, and answer style can be changed.</span>
                </div>
                {clawscale.answerStyle && (
                  <p className="mt-2 text-xs text-gray-500 italic">Style: {clawscale.answerStyle}</p>
                )}
              </div>
              {isAdmin && (
                <button
                  className="text-gray-400 hover:text-gray-700 transition-colors p-1 shrink-0"
                  title="Edit ClawScale settings"
                  onClick={() => { setClawscaleForm(clawscale); setEditingClawscale(true); setClawscaleError(''); }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={saveClawscale} className="space-y-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-gray-900">Edit ClawScale Orchestrator</h3>
                <button type="button" onClick={() => setEditingClawscale(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div>
                <label className="label">Display name</label>
                <input className="input" placeholder="ClawScale Assistant" value={clawscaleForm.name ?? ''}
                  onChange={(e) => setClawscaleForm((f) => ({ ...f, name: e.target.value }))} />
              </div>

              <div>
                <label className="label">
                  Answer style
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <textarea
                  className="input min-h-[80px] resize-y text-sm"
                  placeholder={`e.g. "Always be concise. End with 'Have a great day!'"`}
                  value={clawscaleForm.answerStyle ?? ''}
                  maxLength={500}
                  onChange={(e) => setClawscaleForm((f) => ({ ...f, answerStyle: e.target.value }))}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Appended to knowledge-base and off-topic replies. The backend-selection menu is always shown as-is.
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={clawscaleForm.isActive !== false}
                  onChange={(e) => setClawscaleForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-teal-500" />
                Active (responds to users before a backend is selected)
              </label>

              {clawscaleError && <p className="text-sm text-red-600">{clawscaleError}</p>}

              <div className="flex gap-3">
                <button type="submit" className="btn-primary" disabled={savingClawscale}>
                  {savingClawscale ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditingClawscale(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ── AI Backends ──────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">AI Backends</h2>
          {isAdmin && (
            <button className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add backend
            </button>
          )}
        </div>

        {showForm && (
          <div className="card p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">{editingId ? 'Edit backend' : 'New backend'}</h3>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Name</label>
                  <input className="input" placeholder="e.g. GPT-4o" value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <label className="label">Provider</label>
                  <select className="input" value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AiBackendType, config: {} }))}>
                    {AI_PROVIDER_TYPES.map((t) => (
                      <option key={t} value={t}>{AI_PROVIDER_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <ProviderFields type={form.type} config={form.config}
                onChange={(patch) => setForm((f) => ({ ...f, config: { ...f.config, ...patch } }))} />

              <div>
                <label className="label">
                  Command alias
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <input className="input font-mono text-xs" placeholder="e.g. gpt" maxLength={30}
                  value={(form.config.commandAlias as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, commandAlias: e.target.value.replace(/\s/g, '') } }))} />
                <p className="text-xs text-gray-400 mt-1">
                  Short name for slash commands. Users can type <code>/{form.config.commandAlias || 'alias'} hello</code> to message this backend directly.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-teal-500" />
                  Active (visible to end-users)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.isDefault}
                    onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-teal-500" />
                  Set as default (auto-selected for new users, skips the menu)
                </label>
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

        {backendsLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
          </div>
        ) : backends.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center">
            <BotMessageSquare className="h-9 w-9 text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">No AI backends yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Without a backend, ClawScale will present a menu — but there's nothing to choose from.
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{b.name}</span>
                    {b.isDefault && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                        Default
                      </span>
                    )}
                    {!b.isActive && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Inactive</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {AI_PROVIDER_LABELS[b.type as AiBackendType] ?? b.type}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className={`p-1.5 rounded transition-colors ${b.isDefault ? 'text-amber-500 hover:text-amber-700' : 'text-gray-300 hover:text-amber-400'}`}
                      title={b.isDefault ? 'Remove as default' : 'Set as default'}
                      onClick={() => toggleDefault(b)}
                    >
                      {b.isDefault ? <Star className="h-4 w-4 fill-current" /> : <StarOff className="h-4 w-4" />}
                    </button>
                    <button className="text-gray-400 hover:text-gray-700 transition-colors p-1.5" title="Edit" onClick={() => openEdit(b.id)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="text-gray-400 hover:text-red-500 transition-colors p-1.5"
                      title="Delete" disabled={deletingId === b.id}
                      onClick={() => handleDelete(b.id)}
                    >
                      {deletingId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Provider config fields ────────────────────────────────────────────────────

function ProviderFields({ type, config, onChange }: {
  type: AiBackendType;
  config: AiBackendProviderConfig;
  onChange: (patch: Partial<AiBackendProviderConfig>) => void;
}) {
  const inp = (field: keyof AiBackendProviderConfig, placeholder: string, label: string,
    opts?: { type?: string; hint?: string; required?: boolean }) => (
    <div>
      <label className="label">{label}</label>
      <input className="input font-mono text-xs" type={opts?.type ?? 'text'} placeholder={placeholder}
        value={(config[field] as string) ?? ''} onChange={(e) => onChange({ [field]: e.target.value })}
        required={opts?.required} />
      {opts?.hint && <p className="text-xs text-gray-400 mt-1">{opts.hint}</p>}
    </div>
  );

  const systemPromptField = (
    <div>
      <label className="label">
        System prompt
        <span className="text-gray-400 font-normal ml-1">(optional)</span>
      </label>
      <textarea
        className="input min-h-[80px] resize-y text-sm"
        placeholder="You are a helpful assistant."
        value={(config.systemPrompt as string) ?? ''}
        maxLength={2000}
        onChange={(e) => onChange({ systemPrompt: e.target.value })}
      />
      <p className="text-xs text-gray-400 mt-1">
        This backend's own persona. ClawScale does not inject its own prompt.
      </p>
    </div>
  );

  if (type === 'openai') return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      {inp('apiKey', 'sk-...', 'API Key', { type: 'password', required: true })}
      {inp('model', 'gpt-4o-mini', 'Model')}
    </div>
    {systemPromptField}
  </div>;

  if (type === 'anthropic') return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      {inp('apiKey', 'sk-ant-...', 'API Key', { type: 'password', required: true })}
      {inp('model', 'claude-haiku-4-5-20251001', 'Model')}
    </div>
    {systemPromptField}
  </div>;

  if (type === 'openrouter') return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      {inp('apiKey', 'sk-or-...', 'API Key', { type: 'password', required: true })}
      {inp('model', 'openai/gpt-4o-mini', 'Model')}
    </div>
    {inp('baseUrl', 'https://openrouter.ai/api/v1', 'Base URL (optional)', { hint: 'Leave blank for the default OpenRouter endpoint.' })}
    {systemPromptField}
  </div>;

  if (type === 'openclaw') return <div className="space-y-4">
    {inp('openClawUrl', 'http://localhost:8080', 'OpenClaw URL', { required: true, hint: 'Base URL of your OpenClaw instance. /v1 is appended automatically.' })}
    <div className="grid grid-cols-2 gap-4">
      {inp('apiKey', 'optional', 'API Key (optional)', { type: 'password' })}
      {inp('model', 'default', 'Model (optional)')}
    </div>
  </div>;

  if (type === 'pulse') return inp('pulseApiUrl', 'http://localhost:5000', 'Pulse API URL',
    { required: true, hint: 'Base URL of the Pulse Editor AI manager. /stream is appended automatically.' });

  if (type === 'custom') return <div className="space-y-4">
    {inp('baseUrl', 'https://your-api/v1', 'Base URL', { required: true, hint: 'Must expose an OpenAI-compatible /chat/completions endpoint.' })}
    <div className="grid grid-cols-2 gap-4">
      {inp('apiKey', 'optional', 'API Key (optional)', { type: 'password' })}
      {inp('model', 'model-name', 'Model')}
    </div>
  </div>;

  return null;
}
