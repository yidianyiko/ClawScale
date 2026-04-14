'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, Radio, ArrowRight, Zap, Users, Bot, UserCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { getTenant } from '../../lib/auth';
import { useLocale } from '../../components/locale-provider';
import { getDashboardCopy } from '../../lib/dashboard-copy';
import type { ApiResponse } from '../../../shared/src/types/api';

interface Stats {
  totalMembers: number;
  activeMembers: number;
  totalConversations: number;
  activeChannels: number;
  totalBackends: number;
  totalEndUsers: number;
}

interface ChannelRow { id: string; name: string; type: string; status: string }

export default function Dashboard() {
  const tenant = getTenant();
  const { locale } = useLocale();
  const [stats, setStats] = useState<Stats | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const copy = getDashboardCopy(locale);

  useEffect(() => {
    api.get<ApiResponse<Stats>>('/api/tenant/stats').then((r) => { if (r.ok) setStats(r.data); });
    api.get<ApiResponse<ChannelRow[]>>('/api/channels').then((r) => { if (r.ok) setChannels(r.data); });
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          {tenant ? `${copy.home.welcomeBackTo} ${tenant.name}` : copy.home.welcomeBack}
        </h1>
        <p className="text-gray-500 mt-1">{copy.home.overview}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 mb-8">
        <StatCard icon={<MessageSquare className="h-5 w-5 text-teal-500" />} label={copy.home.stats.totalConversations}
          value={stats?.totalConversations ?? '—'} sub={copy.home.stats.totalConversationsSub} />
        <StatCard icon={<Radio className="h-5 w-5 text-teal-500" />} label={copy.home.stats.activeChannels}
          value={stats?.activeChannels ?? '—'} sub={copy.home.stats.activeChannelsSub(channels.length)} />
        <StatCard icon={<UserCheck className="h-5 w-5 text-teal-500" />} label={copy.home.stats.endUsers}
          value={stats?.totalEndUsers ?? '—'} sub={copy.home.stats.endUsersSub} />
        <StatCard icon={<Users className="h-5 w-5 text-teal-500" />} label={copy.home.stats.teamMembers}
          value={stats?.totalMembers ?? '—'} sub={copy.home.stats.teamMembersSub(stats?.activeMembers ?? 0)} />
        <StatCard icon={<Bot className="h-5 w-5 text-teal-500" />} label={copy.home.stats.aiBackends}
          value={stats?.totalBackends ?? '—'} sub={copy.home.stats.aiBackendsSub} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <QuickCard to="/dashboard/conversations" title={copy.home.quickCards.conversations.title}
          desc={copy.home.quickCards.conversations.desc}
          icon={<MessageSquare className="h-5 w-5" />} />
        <QuickCard to="/dashboard/channels" title={copy.home.quickCards.channels.title}
          desc={copy.home.quickCards.channels.desc}
          icon={<Radio className="h-5 w-5" />} />
        <QuickCard to="/dashboard/workflows" title={copy.home.quickCards.workflows.title}
          desc={copy.home.quickCards.workflows.desc}
          icon={<Zap className="h-5 w-5" />} />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string;
  value: string | number | React.ReactNode; sub: string | React.ReactNode;
}) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className="rounded-lg bg-teal-50 p-2.5">{icon}</div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-semibold text-gray-900 mt-0.5">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

function QuickCard({ to, title, desc, icon }: { to: string; title: string; desc: string; icon: React.ReactNode }) {
  return (
    <Link href={to} className="card p-5 hover:border-teal-300 hover:shadow-md transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className="rounded-lg bg-navy-900/5 p-2 text-navy-900">{icon}</div>
        <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-teal-500 transition-colors" />
      </div>
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{desc}</p>
    </Link>
  );
}
