'use client';
import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { ApiResponse, Conversation } from '@clawscale/shared';

export default function Conversations() {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ApiResponse<Conversation[]>>('/api/conversations').then((r) => {
      if (r.ok) setRows(r.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Conversations</h1>
        <p className="text-gray-500 mt-1">All conversations end-users are having with your bot.</p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-12 text-center">
          <MessageSquare className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No conversations yet. Connect a channel to get started.</p>
          <Link href="/channels" className="btn-primary inline-flex mt-4">Go to Channels</Link>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {rows.map((conv) => (
            <Link key={conv.id} href={`/conversations/${conv.id}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 text-sm font-semibold">
                {(conv.endUser?.name ?? conv.endUser?.externalId ?? '?')[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {conv.endUser?.name ?? conv.endUser?.externalId ?? 'Anonymous'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {conv.channel?.name} · {conv.channel?.type} · {(conv._count?.messages ?? 0)} messages
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400">{formatDateTime(conv.updatedAt)}</p>
                {conv.endUser?.status === 'blocked' && (
                  <span className="text-xs text-red-500 font-medium">Blocked</span>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-teal-500 transition-colors shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
