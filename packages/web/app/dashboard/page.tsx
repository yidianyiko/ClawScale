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

const adminHandoffCards = {
  en: [
    { to: '/admin/customers', title: 'Customers', desc: 'Review customer accounts, claim state, and channel coverage.' },
    { to: '/admin/channels', title: 'Channels', desc: 'Inspect platform channel status and routing health in the admin console.' },
    { to: '/admin/deliveries', title: 'Deliveries', desc: 'Review recent delivery failures and operational follow-up from the admin console.' },
  ],
  zh: [
    { to: '/admin/customers', title: '客户', desc: '查看客户账号、认领状态和渠道覆盖情况。' },
    { to: '/admin/channels', title: '渠道', desc: '在管理后台检查平台渠道状态和路由健康。' },
    { to: '/admin/deliveries', title: '投递', desc: '在管理后台查看近期投递失败和后续处理。' },
  ],
} as const;

export default function Dashboard() {
  const tenant = getTenant();
  const { locale } = useLocale();
  const [stats, setStats] = useState<Stats | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const copy = getDashboardCopy(locale);
  const handoffCards = adminHandoffCards[locale];

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

      <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50/80 p-5">
        <p className="text-sm font-semibold text-amber-900">
          {locale === 'zh'
            ? '旧版工作台已冻结。打开新的管理后台查看客户、渠道和投递。'
            : 'The legacy dashboard is frozen. Open the new admin console for customers, channels, and deliveries.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/admin/customers"
            className="inline-flex items-center rounded-lg bg-amber-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-950"
          >
            {locale === 'zh' ? '打开新的管理后台' : 'Open the new admin console'}
          </Link>
          <Link
            href="/admin/channels"
            className="inline-flex items-center rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 transition-colors hover:border-amber-400 hover:text-amber-950"
          >
            {locale === 'zh' ? '查看管理渠道' : 'Review admin channels'}
          </Link>
        </div>
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
        <QuickCard to={handoffCards[0].to} title={handoffCards[0].title}
          desc={handoffCards[0].desc}
          icon={<Users className="h-5 w-5" />} />
        <QuickCard to={handoffCards[1].to} title={handoffCards[1].title}
          desc={handoffCards[1].desc}
          icon={<Radio className="h-5 w-5" />} />
        <QuickCard to={handoffCards[2].to} title={handoffCards[2].title}
          desc={handoffCards[2].desc}
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
