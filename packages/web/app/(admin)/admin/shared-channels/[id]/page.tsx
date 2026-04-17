'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale } from '../../../../../components/locale-provider';
import {
  adminApi,
  type AdminSharedChannelDetail,
} from '../../../../../lib/admin-api';
import { getAdminCopy } from '../../../../../lib/admin-copy';
import { formatDateTime } from '../../../../../lib/utils';

function titleCase(value: string): string {
  return value ? value.slice(0, 1).toUpperCase() + value.slice(1) : value;
}

function parseConfig(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_config_json');
  }

  return parsed as Record<string, unknown>;
}

export default function AdminSharedChannelDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { locale } = useLocale();
  const copy = getAdminCopy(locale);
  const id = params.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState<AdminSharedChannelDetail | null>(null);
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [configText, setConfigText] = useState('{}');

  useEffect(() => {
    let active = true;

    async function loadDetail() {
      setLoading(true);
      setError('');
      const response = await adminApi.get<AdminSharedChannelDetail>('/api/admin/shared-channels/' + id);

      if (!active) {
        return;
      }

      if (!response.ok) {
        setError(response.error);
        setRecord(null);
        setLoading(false);
        return;
      }

      setRecord(response.data);
      setName(response.data.name);
      setAgentId(response.data.agent?.id ?? '');
      setConfigText(JSON.stringify(response.data.config ?? {}, null, 2));
      setLoading(false);
    }

    void loadDetail();
    return () => {
      active = false;
    };
  }, [id]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');

    const form = new FormData(event.currentTarget);
    const nextName = String(form.get('name') ?? '').trim();
    const nextAgentId = String(form.get('agentId') ?? '').trim();
    const nextConfigText = String(form.get('config') ?? '{}');

    try {
      const response = await adminApi.patch<AdminSharedChannelDetail>('/api/admin/shared-channels/' + id, {
        name: nextName,
        agentId: nextAgentId,
        config: parseConfig(nextConfigText),
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      setRecord(response.data);
      setName(response.data.name);
      setAgentId(response.data.agent?.id ?? '');
      setConfigText(JSON.stringify(response.data.config ?? {}, null, 2));
    } catch {
      setError('invalid_config_json');
    } finally {
      setSaving(false);
    }
  }

  async function handleRetire() {
    if (!window.confirm(copy.admins.confirmRemove)) {
      return;
    }

    setRetiring(true);
    setError('');
    const response = await adminApi.delete<null>('/api/admin/shared-channels/' + id);
    setRetiring(false);

    if (!response.ok) {
      setError(response.error);
      return;
    }

    router.push('/admin/shared-channels');
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <button type="button" className="btn-secondary mb-4" onClick={() => router.push('/admin/shared-channels')}>
          {copy.sharedChannels.actions.back}
        </button>
        <h1 className="text-2xl font-semibold text-gray-900">{copy.sharedChannels.detailTitle}</h1>
        {record ? <p className="mt-2 text-gray-600">{record.name}</p> : null}
      </div>

      <div className="card p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : error && !record ? (
          <p className="text-sm text-red-600">{copy.common.errorPrefix}: {error}</p>
        ) : record ? (
          <form className="space-y-5" onSubmit={(event) => void handleSave(event)}>
            <div>
              <p className="text-sm font-medium text-gray-500">{copy.sharedChannels.columns.status}</p>
              <p className="mt-1 text-base text-gray-900">{titleCase(record.status)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{copy.sharedChannels.columns.updated}</p>
              <p className="mt-1 text-base text-gray-900">{formatDateTime(record.updatedAt)}</p>
            </div>
            <div>
              <label htmlFor="shared-channel-detail-name" className="label">
                {copy.sharedChannels.fields.name}
              </label>
              <input
                id="shared-channel-detail-name"
                name="name"
                className="input"
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="shared-channel-detail-agent-id" className="label">
                {copy.sharedChannels.fields.agentId}
              </label>
              <input
                id="shared-channel-detail-agent-id"
                name="agentId"
                className="input"
                value={agentId}
                onInput={(event) => setAgentId(event.currentTarget.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="shared-channel-detail-config" className="label">
                {copy.sharedChannels.fields.config}
              </label>
              <textarea
                id="shared-channel-detail-config"
                name="config"
                className="input min-h-[160px]"
                value={configText}
                onInput={(event) => setConfigText(event.currentTarget.value)}
              />
            </div>
            {error ? <p className="text-sm text-red-600">{copy.common.errorPrefix}: {error}</p> : null}
            <div className="flex gap-3">
              <button
                type="submit"
                className="btn-primary"
                data-testid="save-shared-channel"
                disabled={saving}
              >
                {saving ? copy.common.loading : copy.sharedChannels.actions.save}
              </button>
              <button
                type="button"
                className="btn-secondary"
                data-testid="retire-shared-channel"
                disabled={retiring}
                onClick={() => void handleRetire()}
              >
                {retiring ? copy.common.loading : copy.sharedChannels.actions.retire}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
