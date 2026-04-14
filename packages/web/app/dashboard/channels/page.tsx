'use client';
import { useEffect, useState, useRef } from 'react';
import { Plus, Loader2, Plug, PlugZap, Trash2, Radio, Pencil, Check, X, Copy, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useLocale } from '@/components/locale-provider';
import { getLocalizedChannelCopy } from '@/lib/dashboard-schema-copy';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '../../../../shared/src/types/api';
import type { ChannelType, Channel } from '../../../../shared/src/types/channel';
import { isAdminAddChannelTypeAllowed } from './channel-options';

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '📱', whatsapp_business: '🟢', telegram: '✈️', slack: '💬', discord: '🎮', instagram: '📸',
  facebook: '👥', line: '💚', signal: '🔒', teams: '🏢', matrix: '🔷', web: '🌐',
  wechat_work: '💼', wechat_personal: '💚',
};

const STATUS_BADGE: Record<string, string> = {
  connected: 'badge-green', disconnected: 'badge-gray', pending: 'badge-yellow', error: 'badge-red',
};


type ChannelRow = Omit<Channel, 'config'>;

export default function Channels() {
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const { locale } = useLocale();
  const copy = getLocalizedChannelCopy(locale);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<ChannelType>('whatsapp');
  const [addName, setAddName] = useState('');
  const [addConfig, setAddConfig] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // WhatsApp QR modal
  const [qrChannelId, setQrChannelId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string | null>(null);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const res = await api.get<ApiResponse<ChannelRow[]>>('/api/channels');
    if (res.ok) setChannels(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  // Poll QR endpoint while modal is open
  useEffect(() => {
    if (!qrChannelId) {
      if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
      return;
    }

    async function pollQR() {
      if (!qrChannelId) return;
      const res = await api.get<ApiResponse<{ qr: string | null; qrUrl: string | null; status: string | null }>>(`/api/channels/${qrChannelId}/qr`);
      if (!res.ok) return;
      setQrImage(res.data.qr);
      setQrUrl(res.data.qrUrl);
      setQrStatus(res.data.status);
      if (res.data.status === 'connected') {
        setChannels((prev) => prev.map((c) => c.id === qrChannelId ? { ...c, status: 'connected' as const } : c));
        closeQrModal();
      }
    }

    void pollQR();
    qrPollRef.current = setInterval(pollQR, 3000);
    return () => { if (qrPollRef.current) clearInterval(qrPollRef.current); };
  }, [qrChannelId]);

  function closeQrModal() {
    setQrChannelId(null);
    setQrImage(null);
    setQrUrl(null);
    setQrStatus(null);
  }

  function resetAddForm() { setAddName(''); setAddConfig({}); setAddError(''); setAddType('whatsapp'); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setAddError(''); setAdding(true);
    try {
      const res = await api.post<ApiResponse<ChannelRow>>('/api/channels', { type: addType, name: addName, config: addConfig });
      if (!res.ok) { setAddError(copy.genericError); return; }
      setChannels((prev) => [...prev, res.data]);
      setShowAdd(false); resetAddForm();
    } finally { setAdding(false); }
  }

  async function handleConnect(ch: ChannelRow) {
    setActionLoading(ch.id);
    try {
      const res = await api.post<ApiResponse<{ status: string }>>(`/api/channels/${ch.id}/connect`);
      if (!res.ok) return;
      const newStatus = res.data.status as ChannelRow['status'];
      setChannels((prev) => prev.map((c) => c.id === ch.id ? { ...c, status: newStatus } : c));
      if (ch.type === 'whatsapp' || ch.type === 'wechat_personal') {
        setQrChannelId(ch.id);
      }
    } finally { setActionLoading(null); }
  }

  async function handleDisconnect(id: string) {
    setActionLoading(id);
    try {
      const res = await api.post<ApiResponse<{ status: string }>>(`/api/channels/${id}/disconnect`);
      if (res.ok) setChannels((prev) => prev.map((c) => c.id === id ? { ...c, status: 'disconnected' as const } : c));
    } finally { setActionLoading(null); }
  }

  async function handleDelete(id: string) {
    if (!confirm(copy.deleteConfirm)) return;
    const res = await api.delete<ApiResponse<null>>(`/api/channels/${id}`);
    if (res.ok) setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  // Inline rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  function startRename(ch: ChannelRow) {
    setEditingId(ch.id);
    setEditName(ch.name);
    setTimeout(() => editRef.current?.focus(), 0);
  }

  async function saveRename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) { setEditingId(null); return; }
    const res = await api.patch<ApiResponse<Channel>>(`/api/channels/${id}`, { name: trimmed });
    if (res.ok) setChannels((prev) => prev.map((c) => c.id === id ? { ...c, name: trimmed } : c));
    setEditingId(null);
  }

  // Edit channel modal
  const [editChannelId, setEditChannelId] = useState<string | null>(null);
  const [editChannelType, setEditChannelType] = useState<ChannelType>('whatsapp');
  const [editChannelName, setEditChannelName] = useState('');
  const [editChannelConfig, setEditChannelConfig] = useState<Record<string, string>>({});
  const [editChannelError, setEditChannelError] = useState('');
  const [editChannelLoading, setEditChannelLoading] = useState(false);
  const [editChannelSaving, setEditChannelSaving] = useState(false);

  async function openEditChannel(ch: ChannelRow) {
    setEditChannelId(ch.id);
    setEditChannelType(ch.type as ChannelType);
    setEditChannelName(ch.name);
    setEditChannelConfig({});
    setEditChannelError('');
    setEditChannelLoading(true);
    try {
      const res = await api.get<ApiResponse<Channel>>(`/api/channels/${ch.id}`);
      if (res.ok && res.data.config) {
        const cfg: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.data.config)) {
          cfg[k] = String(v ?? '');
        }
        setEditChannelConfig(cfg);
      }
    } finally { setEditChannelLoading(false); }
  }

  function closeEditChannel() {
    setEditChannelId(null);
    setEditChannelError('');
  }

  async function saveEditChannel(e: React.FormEvent) {
    e.preventDefault();
    setEditChannelError('');
    setEditChannelSaving(true);
    try {
      const res = await api.patch<ApiResponse<Channel>>(`/api/channels/${editChannelId}`, {
        name: editChannelName,
        config: editChannelConfig,
      });
      if (!res.ok) { setEditChannelError(copy.genericError); return; }
      setChannels((prev) => prev.map((c) => c.id === editChannelId ? { ...c, name: editChannelName } : c));
      closeEditChannel();
    } finally { setEditChannelSaving(false); }
  }

  const schema = copy.schema[addType];
  const editSchema = copy.schema[editChannelType];

  const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? '';

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{copy.pageTitle}</h1>
          <p className="text-gray-500 mt-1">{copy.pageDescription}</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> {copy.addChannelButton}</button>}
      </div>

      {/* Add channel modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">{copy.addModalTitle}</h2>
            {addError && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{addError}</div>}
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="label">{copy.platformLabel}</label>
                <select className="input" value={addType} onChange={(e) => { setAddType(e.target.value as ChannelType); setAddConfig({}); }}>
                  {Object.entries(copy.schema)
                    .filter(([type]) => isAdminAddChannelTypeAllowed(type))
                    .map(([type, s]) => (
                    <option key={type} value={type}>{CHANNEL_ICONS[type] ?? '🔌'} {s.label}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="label">{copy.displayNameLabel}</label>
                <input className="input" placeholder={`${copy.displayNamePlaceholderPrefix} ${schema.label}`} value={addName} onChange={(e) => setAddName(e.target.value)} required />
              </div>
              {addType === 'whatsapp' && (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                  {copy.addWhatsappHint}
                </p>
              )}
              {schema.fields.map((field) => (
                <div key={field.key}>
                  <label className="label">{field.label}{field.required && <span className="text-red-500 ml-1">*</span>}</label>
                  <input className="input" type={field.type} placeholder={field.placeholder}
                    value={addConfig[field.key] ?? ''} onChange={(e) => setAddConfig((p) => ({ ...p, [field.key]: e.target.value }))}
                    required={field.required} />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1" disabled={adding}>
                  {adding && <Loader2 className="h-4 w-4 animate-spin" />} {copy.addSubmit}
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => { setShowAdd(false); resetAddForm(); }}>{copy.cancel}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp QR modal */}
      {qrChannelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-sm p-6 text-center">
            <h2 className="text-lg font-semibold mb-1">{copy.qrTitle}</h2>
            <p className="text-sm text-gray-500 mb-5">
              {copy.qrInstructions[channels.find((c) => c.id === qrChannelId)?.type === 'wechat_personal' ? 'wechat_personal' : 'whatsapp']}
            </p>
            {qrImage ? (
              <img src={qrImage} alt={copy.qrImageAlt} className="mx-auto w-56 h-56 rounded-lg border border-gray-200" />
            ) : (
              <div className="mx-auto w-56 h-56 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
              </div>
            )}
            {qrUrl && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="truncate text-xs text-gray-600 flex-1">{qrUrl}</span>
                <button
                  type="button"
                  className="shrink-0 text-xs text-teal-600 hover:text-teal-700 font-medium"
                  onClick={() => void navigator.clipboard.writeText(qrUrl)}
                >
                  {copy.qrCopy}
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-gray-400">
              {qrStatus === 'qr_pending' ? copy.qrPending : qrStatus ?? copy.qrGenerating}
            </p>
            <button className="btn-secondary w-full mt-5" onClick={closeQrModal}>{copy.cancel}</button>
          </div>
        </div>
      )}

      {/* Edit channel modal */}
      {editChannelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{copy.editModalTitle}</h2>
              <button onClick={closeEditChannel} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
            </div>
            {editChannelLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
              </div>
            ) : (
              <form onSubmit={saveEditChannel} className="space-y-4">
                {editChannelError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{editChannelError}</div>}
                <div>
                  <label className="label">{copy.displayNameLabel}</label>
                  <input className="input" value={editChannelName} onChange={(e) => setEditChannelName(e.target.value)} required />
                </div>
                {editSchema.fields.map((field) => (
                  <div key={field.key}>
                    <label className="label">{field.label}{field.required && <span className="text-red-500 ml-1">*</span>}</label>
                    <input className="input" type={field.type} placeholder={field.placeholder}
                      value={editChannelConfig[field.key] ?? ''} onChange={(e) => setEditChannelConfig((p) => ({ ...p, [field.key]: e.target.value }))}
                      required={field.required} />
                  </div>
                ))}
                {editSchema.fields.length === 0 && (
                  <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">{copy.noSettings}</p>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1" disabled={editChannelSaving}>
                    {editChannelSaving && <Loader2 className="h-4 w-4 animate-spin" />} {copy.saveChanges}
                  </button>
                  <button type="button" className="btn-secondary flex-1" onClick={closeEditChannel}>{copy.cancel}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
      ) : channels.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Radio className="h-10 w-10 text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">{copy.emptyTitle}</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">{copy.emptyDescription}</p>
          {isAdmin && <button className="btn-primary mt-5" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> {copy.addFirstChannel}</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {channels.map((ch) => (
            <div key={ch.id} className="card p-5 relative">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{CHANNEL_ICONS[ch.type] ?? '🔌'}</span>
                  <div>
                    {editingId === ch.id ? (
                      <div className="flex items-center gap-1">
                        <input ref={editRef} className="input py-0.5 px-1.5 text-sm font-semibold w-32"
                          value={editName} onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveRename(ch.id); if (e.key === 'Escape') setEditingId(null); }} />
                        <button onClick={() => saveRename(ch.id)} className="text-teal-500 hover:text-teal-700"><Check className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <p className="font-semibold text-gray-900 group/name flex items-center gap-1.5">
                        {ch.name}
                        {isAdmin && (
                          <button onClick={() => startRename(ch)} className="opacity-0 group-hover/name:opacity-100 text-gray-400 hover:text-teal-500 transition-opacity">
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 capitalize leading-none">
                      {copy.schemaLabelByType[ch.type]}
                      {ch.type === 'whatsapp_business' && (
                        <> · <WebhookToggle channelId={ch.id} apiBase={apiBase} webhookCopy={copy.webhook} /></>
                      )}
                    </p>
                  </div>
                </div>
                <span className={cn(STATUS_BADGE[ch.status])}>{copy.status[ch.status]}</span>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 mt-4">
                  {ch.status === 'connected' ? (
                    <button className="btn-secondary flex-1 text-xs" onClick={() => handleDisconnect(ch.id)} disabled={actionLoading === ch.id}>
                      {actionLoading === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} {copy.disconnect}
                    </button>
                  ) : ch.status === 'pending' ? (
                    <button className="btn-primary flex-1 text-xs" onClick={() => setQrChannelId(ch.id)} disabled={ch.type !== 'whatsapp' && ch.type !== 'wechat_personal'}>
                      {ch.type === 'whatsapp' || ch.type === 'wechat_personal' ? `📷 ${copy.showQr}` : copy.connecting}
                    </button>
                  ) : (
                    <button className="btn-primary flex-1 text-xs" onClick={() => handleConnect(ch)} disabled={actionLoading === ch.id}>
                      {actionLoading === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} {copy.connect}
                    </button>
                  )}
                  <button className="text-gray-400 hover:text-gray-700 transition-colors p-1" onClick={() => openEditChannel(ch)} title={copy.settingsTitle}>
                    <Settings className="h-4 w-4" />
                  </button>
                  <button className="text-gray-400 hover:text-red-500 transition-colors p-1" onClick={() => handleDelete(ch.id)} title={copy.deleteTitle}>
                    <Trash2 className="h-4 w-4" />
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

// ── WhatsApp Business webhook setup instructions ─────────────────────────────

function WebhookToggle({
  channelId,
  apiBase,
  webhookCopy,
}: {
  channelId: string;
  apiBase: string;
  webhookCopy: ReturnType<typeof getLocalizedChannelCopy>['webhook'];
}) {
  const webhookUrl = `${apiBase}/gateway/whatsapp/${channelId}`;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copyValue(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <>
      <button
        type="button"
        className="text-blue-500 hover:text-blue-700 hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? webhookCopy.hideSetup : webhookCopy.showSetup}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-800 space-y-2">
          <p>{webhookCopy.intro}</p>
          <div className="space-y-1.5">
            <div>
              <span className="text-blue-600 font-medium">{webhookCopy.callbackUrl}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <code className="flex-1 bg-white rounded px-2 py-1 text-[11px] border border-blue-200 truncate select-all">{webhookUrl}</code>
                <button type="button" onClick={() => copyValue(webhookUrl, 'url')} className="shrink-0 text-blue-500 hover:text-blue-700" title={copied === 'url' ? webhookCopy.copiedTitle : webhookCopy.copyTitle}>
                  {copied === 'url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <p><span className="text-blue-600 font-medium">{webhookCopy.verifyToken}</span> {webhookCopy.verifyTokenValue}</p>
            <p><span className="text-blue-600 font-medium">{webhookCopy.webhookFields}</span> {webhookCopy.webhookFieldsValue}</p>
          </div>
        </div>
      )}
    </>
  );
}
