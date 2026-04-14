'use client';
import { useEffect, useState } from 'react';
import { Loader2, Link2, ShieldCheck, ShieldBan } from 'lucide-react';
import { api } from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { getDashboardCopy } from '@/lib/dashboard-copy';
import { cn, formatDate } from '@/lib/utils';
import type { ApiResponse } from '../../../../shared/src/types/api';

interface EndUser {
  id: string;
  tenantId: string;
  channelId: string;
  externalId: string;
  name: string | null;
  email: string | null;
  status: 'allowed' | 'blocked';
  linkedTo: string | null;
  clawscaleUserId: string | null;
  clawscaleUser: { id: string; cokeAccountId: string } | null;
  createdAt: string;
  updatedAt: string;
  channel: { name: string; type: string };
  _count: { conversations: number };
}

interface EndUsersResponse {
  rows: EndUser[];
  total: number;
}

const STATUS_BADGE: Record<string, string> = {
  allowed: 'badge-teal',
  blocked: 'badge-red',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  allowed: <ShieldCheck className="h-3.5 w-3.5" />,
  blocked: <ShieldBan className="h-3.5 w-3.5" />,
};

export default function EndUsers() {
  const { locale } = useLocale();
  const [data, setData] = useState<EndUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const copy = getDashboardCopy(locale);

  async function load(off: number) {
    setLoading(true);
    const res = await api.get<ApiResponse<EndUsersResponse>>(`/api/end-users?limit=${limit}&offset=${off}`);
    if (res.ok) setData(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(offset); }, [offset]);

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const hasNext = offset + limit < total;
  const hasPrev = offset > 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{copy.endUsers.title}</h1>
          <p className="text-gray-500 mt-1">{copy.endUsers.summary(total)}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-sm">{copy.endUsers.empty}</p>
            <p className="text-xs mt-1">{copy.endUsers.emptyHint}</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.endUsers.columns.user}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.endUsers.columns.channel}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.endUsers.columns.status}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.endUsers.columns.conversations}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.endUsers.columns.linked}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.endUsers.columns.joined}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-teal-600 font-semibold text-sm">
                          {(u.name ?? u.externalId)[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{u.name ?? u.externalId}</p>
                          {u.email && <p className="text-xs text-gray-400">{u.email}</p>}
                          {u.name && <p className="text-xs text-gray-400 font-mono">{u.externalId}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-gray-900">{u.channel.name}</p>
                        <p className="text-xs text-gray-400">{copy.onboard.channelLabels[u.channel.type] ?? u.channel.type}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn(STATUS_BADGE[u.status], 'flex items-center gap-1 w-fit')}>
                        {STATUS_ICON[u.status]} {copy.endUsers.statuses[u.status] ?? u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{u._count.conversations}</td>
                    <td className="px-5 py-3.5">
                      {u.clawscaleUserId && u.clawscaleUser ? (
                        <div className="space-y-1 text-xs">
                          <p className="font-mono text-teal-700">{u.clawscaleUserId}</p>
                          <p className="text-gray-400">
                            {copy.endUsers.cokeAccount(u.clawscaleUser.cokeAccountId)}
                          </p>
                        </div>
                      ) : u.linkedTo ? (
                        <span className="flex items-center gap-1 text-amber-600 text-xs">
                          <Link2 className="h-3.5 w-3.5" /> {copy.endUsers.legacyLink}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">{copy.endUsers.unbound}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {total > limit && (
              <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
                <p className="text-xs text-gray-400">
                  {copy.endUsers.showing(offset + 1, Math.min(offset + limit, total), total)}
                </p>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary text-xs px-3 py-1"
                    disabled={!hasPrev}
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  >
                    {copy.endUsers.previous}
                  </button>
                  <button
                    className="btn-secondary text-xs px-3 py-1"
                    disabled={!hasNext}
                    onClick={() => setOffset((o) => o + limit)}
                  >
                    {copy.endUsers.next}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
