'use client';
import { useEffect, useState, useRef } from 'react';
import { Plus, Loader2, Plug, PlugZap, Trash2, Radio } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { CHANNEL_CONFIG_SCHEMA, type ChannelType, type Channel } from '@clawscale/shared';
import type { ApiResponse } from '@clawscale/shared';

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
      if (!res.ok) { setAddError(res.error); return; }
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
    if (!confirm('Delete this channel? This cannot be undone.')) return;
    const res = await api.delete<ApiResponse<null>>(`/api/channels/${id}`);
    if (res.ok) setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  const schema = CHANNEL_CONFIG_SCHEMA[addType];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Channels</h1>
          <p className="text-gray-500 mt-1">Connect messaging platforms to your AI assistant.</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add channel</button>}
      </div>

      {/* Add channel modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Add a channel</h2>
            {addError && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{addError}</div>}
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="label">Platform</label>
                <select className="input" value={addType} onChange={(e) => { setAddType(e.target.value as ChannelType); setAddConfig({}); }}>
                  {Object.entries(CHANNEL_CONFIG_SCHEMA).map(([type, s]) => (
                    <option key={type} value={type}>{CHANNEL_ICONS[type] ?? '🔌'} {s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Display name</label>
                <input className="input" placeholder={`My ${schema.label}`} value={addName} onChange={(e) => setAddName(e.target.value)} required />
              </div>
              {(addType === 'whatsapp' || addType === 'wechat_personal') && (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                  After adding, click <strong>Connect</strong> to get a QR code to scan with your phone.
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
                  {adding && <Loader2 className="h-4 w-4 animate-spin" />} Add channel
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => { setShowAdd(false); resetAddForm(); }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp QR modal */}
      {qrChannelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-sm p-6 text-center">
            <h2 className="text-lg font-semibold mb-1">Scan QR Code</h2>
            <p className="text-sm text-gray-500 mb-5">
              {channels.find((c) => c.id === qrChannelId)?.type === 'wechat_personal'
                ? 'Open WeChat → Me → WeChat ID → scan the code'
                : 'Open WhatsApp → Linked Devices → Link a device'}
            </p>
            {qrImage ? (
              <img src={qrImage} alt="QR Code" className="mx-auto w-56 h-56 rounded-lg border border-gray-200" />
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
                  Copy
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-gray-400">
              {qrStatus === 'qr_pending' ? 'Waiting for scan…' : qrStatus ?? 'Generating QR…'}
            </p>
            <button className="btn-secondary w-full mt-5" onClick={closeQrModal}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
      ) : channels.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Radio className="h-10 w-10 text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No channels yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">Connect WhatsApp, Telegram, Discord, and more to start routing messages through your AI assistant.</p>
          {isAdmin && <button className="btn-primary mt-5" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add your first channel</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {channels.map((ch) => (
            <div key={ch.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{CHANNEL_ICONS[ch.type] ?? '🔌'}</span>
                  <div>
                    <p className="font-semibold text-gray-900">{ch.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{ch.type.replace('_', ' ')}</p>
                  </div>
                </div>
                <span className={cn(STATUS_BADGE[ch.status])}>{ch.status}</span>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 mt-4">
                  {ch.status === 'connected' ? (
                    <button className="btn-secondary flex-1 text-xs" onClick={() => handleDisconnect(ch.id)} disabled={actionLoading === ch.id}>
                      {actionLoading === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Disconnect
                    </button>
                  ) : ch.status === 'pending' ? (
                    <button className="btn-primary flex-1 text-xs" onClick={() => setQrChannelId(ch.id)} disabled={ch.type !== 'whatsapp' && ch.type !== 'wechat_personal'}>
                      {ch.type === 'whatsapp' || ch.type === 'wechat_personal' ? '📷 Show QR' : 'Connecting…'}
                    </button>
                  ) : (
                    <button className="btn-primary flex-1 text-xs" onClick={() => handleConnect(ch)} disabled={actionLoading === ch.id}>
                      {actionLoading === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Connect
                    </button>
                  )}
                  <button className="text-gray-400 hover:text-red-500 transition-colors p-1" onClick={() => handleDelete(ch.id)} title="Delete channel">
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
