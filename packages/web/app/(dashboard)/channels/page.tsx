'use client';
import { useEffect, useState } from 'react';
import { Plus, Loader2, Plug, PlugZap, Trash2, Radio } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { CHANNEL_CONFIG_SCHEMA, type ChannelType, type Channel } from '@clawscale/shared';
import type { ApiResponse } from '@clawscale/shared';

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '📱', telegram: '✈️', slack: '💬', discord: '🎮', instagram: '📸',
  facebook: '👥', line: '💚', signal: '🔒', teams: '🏢', matrix: '🔷', web: '🌐',
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

  async function load() {
    const res = await api.get<ApiResponse<ChannelRow[]>>('/api/channels');
    if (res.ok) setChannels(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

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

  async function handleConnect(id: string) {
    setActionLoading(id);
    try {
      const res = await api.post<ApiResponse<{ status: string; gatewayPort: number }>>(`/api/channels/${id}/connect`);
      if (res.ok) setChannels((prev) => prev.map((c) => c.id === id ? { ...c, status: 'connected' as const, gatewayPort: res.data.gatewayPort } : c));
    } finally { setActionLoading(null); }
  }

  async function handleDisconnect(id: string) {
    setActionLoading(id);
    try {
      const res = await api.post<ApiResponse<{ status: string }>>(`/api/channels/${id}/disconnect`);
      if (res.ok) setChannels((prev) => prev.map((c) => c.id === id ? { ...c, status: 'disconnected' as const, gatewayPort: null } : c));
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

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
      ) : channels.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Radio className="h-10 w-10 text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No channels yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">Connect WhatsApp, Telegram, Slack, and more to start routing messages through your AI assistant.</p>
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
                    <p className="text-xs text-gray-400 capitalize">{ch.type}</p>
                  </div>
                </div>
                <span className={cn(STATUS_BADGE[ch.status])}>{ch.status}</span>
              </div>
              {ch.gatewayPort && <p className="text-xs text-gray-400 mb-3 font-mono">gateway :{ch.gatewayPort}</p>}
              {isAdmin && (
                <div className="flex items-center gap-2 mt-4">
                  {ch.status === 'connected' ? (
                    <button className="btn-secondary flex-1 text-xs" onClick={() => handleDisconnect(ch.id)} disabled={actionLoading === ch.id}>
                      {actionLoading === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Disconnect
                    </button>
                  ) : (
                    <button className="btn-primary flex-1 text-xs" onClick={() => handleConnect(ch.id)} disabled={actionLoading === ch.id || ch.status === 'pending'}>
                      {actionLoading === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                      {ch.status === 'pending' ? 'Connecting…' : 'Connect'}
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
