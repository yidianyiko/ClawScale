'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocale } from '../../../../components/locale-provider';
import { adminApi, type AdminAgentRecord } from '../../../../lib/admin-api';
import { getAdminCopy } from '../../../../lib/admin-copy';
import { formatDateTime } from '../../../../lib/utils';

export default function AdminAgentsPage() {
  const { locale } = useLocale();
  const copy = getAdminCopy(locale);
  const [agent, setAgent] = useState<AdminAgentRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadAgent() {
      const response = await adminApi.get<AdminAgentRecord>('/api/admin/agents');
      if (!active) {
        return;
      }

      if (response.ok) {
        setAgent(response.data);
      }

      setLoading(false);
    }

    void loadAgent();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">{copy.agents.title}</h1>
        <p className="mt-1 text-gray-500">{copy.agents.subtitle}</p>
      </div>

      <div className="card p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : !agent ? (
          <p className="text-sm text-gray-500">{copy.common.empty}</p>
        ) : (
          <div className="space-y-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="font-medium">{copy.common.readOnly}</div>
              <div className="mt-1">{copy.common.readOnlyDescription}</div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.slug}</div>
                <div className="mt-2 text-sm text-gray-700">{agent.slug}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.endpoint}</div>
                <div className="mt-2 text-sm text-gray-700">{agent.endpoint}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.tokenConfigured}</div>
                <div className="mt-2 text-sm text-gray-700">{agent.tokenConfigured ? 'Yes' : 'No'}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.defaultAgent}</div>
                <div className="mt-2 text-sm text-gray-700">{agent.isDefault ? 'Yes' : 'No'}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.healthStatus}</div>
                <div className="mt-2 text-sm text-gray-700">{agent.lastHandshakeHealth.status}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.healthSource}</div>
                <div className="mt-2 text-sm text-gray-700">{agent.lastHandshakeHealth.source}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.observedAt}</div>
                <div className="mt-2 text-sm text-gray-700">
                  {agent.lastHandshakeHealth.observedAt ? formatDateTime(agent.lastHandshakeHealth.observedAt) : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">{copy.agents.fields.updatedAt}</div>
                <div className="mt-2 text-sm text-gray-700">{formatDateTime(agent.updatedAt)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
