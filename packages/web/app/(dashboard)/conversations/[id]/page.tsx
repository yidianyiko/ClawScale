'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, User, Bot, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime, cn } from '@/lib/utils';
import type { ApiResponse, Conversation } from '@clawscale/shared';

export default function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get<ApiResponse<Conversation>>(`/api/conversations/${id}`).then((r) => {
      if (r.ok) setConv(r.data);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;
  if (!conv) return <div className="p-8 text-gray-500">Conversation not found.</div>;

  async function handleDelete() {
    if (!confirm('Delete this conversation and all its messages? This cannot be undone.')) return;
    setDeleting(true);
    const res = await api.delete<{ ok: boolean }>(`/api/conversations/${id}`);
    if (res.ok) {
      router.push('/conversations');
    } else {
      setDeleting(false);
      alert('Failed to delete conversation.');
    }
  }

  const displayName = conv.endUser?.name ?? conv.endUser?.externalId ?? 'Anonymous';

  return (
    <div className="p-8 max-w-3xl">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="card p-5 mb-6 flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 text-lg font-semibold">
          {displayName[0]?.toUpperCase()}
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">{displayName}</p>
          <p className="text-sm text-gray-400">
            {conv.channel?.name} · {conv.channel?.type}
            {conv.endUser?.email && ` · ${conv.endUser.email}`}
          </p>
        </div>
        {conv.endUser?.status === 'blocked' && (
          <span className="badge-red text-xs">Blocked</span>
        )}
        <button onClick={handleDelete} disabled={deleting}
          className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 transition-colors disabled:opacity-50">
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Delete
        </button>
      </div>

      <div className="space-y-4">
        {(conv.messages ?? []).map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'assistant' ? 'flex-row-reverse' : '')}>
            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs',
              msg.role === 'user' ? 'bg-gray-100 text-gray-600' : 'bg-teal-500/20 text-teal-600')}>
              {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={cn('max-w-[75%] rounded-2xl px-4 py-2.5 text-sm',
              msg.role === 'user' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-teal-500 text-white')}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              <p className={cn('text-[10px] mt-1', msg.role === 'user' ? 'text-gray-400' : 'text-teal-100')}>
                {formatDateTime(msg.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
