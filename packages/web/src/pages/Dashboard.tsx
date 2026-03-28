import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Radio, ArrowRight, Zap } from 'lucide-react';
import { api } from '../lib/api.ts';
import { getTenant } from '../lib/auth.ts';
import type { ApiResponse } from '@clawscale/shared';

interface Stats {
  plan: string;
  totalUsers: number;
  activeUsers: number;
  settings: {
    personaName?: string;
    maxUsers?: number;
    maxChannels?: number;
  };
}

interface ChannelRow { id: string; name: string; type: string; status: string }

export default function Dashboard() {
  const tenant = getTenant();
  const [stats, setStats] = useState<Stats | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);

  useEffect(() => {
    api.get<ApiResponse<Stats>>('/api/tenant/stats').then((r) => {
      if (r.ok) setStats(r.data);
    });
    api.get<ApiResponse<ChannelRow[]>>('/api/channels').then((r) => {
      if (r.ok) setChannels(r.data);
    });
  }, []);

  const connectedChannels = channels.filter((c) => c.status === 'connected').length;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          Welcome back{tenant ? ` to ${tenant.name}` : ''}
        </h1>
        <p className="text-gray-500 mt-1">Here's an overview of your workspace.</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        <StatCard
          icon={<Users className="h-5 w-5 text-teal-500" />}
          label="Active users"
          value={stats?.activeUsers ?? '—'}
          sub={stats ? `of ${stats.settings.maxUsers ?? '?'} max` : ''}
        />
        <StatCard
          icon={<Radio className="h-5 w-5 text-teal-500" />}
          label="Connected channels"
          value={connectedChannels}
          sub={`${channels.length} total`}
        />
        <StatCard
          icon={<Zap className="h-5 w-5 text-teal-500" />}
          label="AI persona"
          value={stats?.settings.personaName ?? 'Assistant'}
          sub={<span className="capitalize">{stats?.plan ?? 'starter'} plan</span>}
        />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <QuickCard
          to="/users"
          title="Manage team"
          desc="Invite members, assign roles, and control who has access to your workspace."
          icon={<Users className="h-5 w-5" />}
        />
        <QuickCard
          to="/channels"
          title="Connect channels"
          desc="Link WhatsApp, Telegram, Slack, and 8+ more platforms to your AI assistant."
          icon={<Radio className="h-5 w-5" />}
        />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number | React.ReactNode;
  sub: string | React.ReactNode;
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

function QuickCard({
  to,
  title,
  desc,
  icon,
}: {
  to: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <Link to={to} className="card p-5 hover:border-teal-300 hover:shadow-md transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className="rounded-lg bg-navy-900/5 p-2 text-navy-900">{icon}</div>
        <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-teal-500 transition-colors" />
      </div>
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{desc}</p>
    </Link>
  );
}
