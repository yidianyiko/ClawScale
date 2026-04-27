'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from '../../../../components/locale-provider';
import {
  adminApi,
  type AdminPagedResult,
  type AdminSharedChannelRow,
} from '../../../../lib/admin-api';
import { getAdminCopy } from '../../../../lib/admin-copy';
import { formatDateTime } from '../../../../lib/utils';

const PAGE_SIZE = 50;
const DEFAULT_KIND = 'whatsapp';
const WHATSAPP_EVOLUTION_KIND = 'whatsapp_evolution';
const LINQ_KIND = 'linq';

function buildSharedChannelDetailHref(id: string): string {
  return '/admin/shared-channels/detail?id=' + encodeURIComponent(id);
}

function isWhatsAppEvolutionKind(kind: string): boolean {
  return kind === WHATSAPP_EVOLUTION_KIND;
}

function isLinqKind(kind: string): boolean {
  return kind === LINQ_KIND;
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

export default function AdminSharedChannelsPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = getAdminCopy(locale);
  const [rows, setRows] = useState<AdminSharedChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState(DEFAULT_KIND);
  const [agentId, setAgentId] = useState('');
  const [configText, setConfigText] = useState('{}');
  const [instanceName, setInstanceName] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadSharedChannels() {
      setLoading(true);
      setError('');
      const response = await adminApi.get<AdminPagedResult<AdminSharedChannelRow>>(
        '/api/admin/shared-channels?limit=' + PAGE_SIZE + '&offset=0',
      );

      if (!active) {
        return;
      }

      if (!response.ok) {
        setRows([]);
        setError(response.error);
        setLoading(false);
        return;
      }

      setRows(response.data.rows);
      setLoading(false);
    }

    void loadSharedChannels();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError('');

    const form = new FormData(event.currentTarget);
    const nextName = String(form.get('name') ?? '').trim();
    const nextKind = String(form.get('kind') ?? DEFAULT_KIND).trim() || DEFAULT_KIND;
    const nextAgentId = String(form.get('agentId') ?? '').trim();
    const nextInstanceName = String(form.get('instanceName') ?? '').trim();
    const nextFromNumber = String(form.get('fromNumber') ?? '').trim();
    const nextConfigText = String(form.get('config') ?? '{}');

    try {
      const config = isWhatsAppEvolutionKind(nextKind)
        ? {
            instanceName: nextInstanceName,
          }
        : isLinqKind(nextKind)
          ? {
              fromNumber: nextFromNumber,
            }
          : parseConfig(nextConfigText);

      const response = await adminApi.post<AdminSharedChannelRow>('/api/admin/shared-channels', {
        name: nextName,
        kind: nextKind,
        agentId: nextAgentId,
        config,
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      router.push(buildSharedChannelDetailHref(response.data.id));
    } catch {
      setError('invalid_config_json');
    } finally {
      setCreating(false);
    }
  }

  const evolutionCreateMode = isWhatsAppEvolutionKind(kind);
  const linqCreateMode = isLinqKind(kind);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{copy.sharedChannels.title}</h1>
          <p className="mt-1 text-gray-500">{copy.sharedChannels.subtitle}</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          data-testid="open-create-shared-channel"
          onClick={() => setShowCreate((current) => !current)}
        >
          {copy.sharedChannels.openCreate}
        </button>
      </div>

      {showCreate ? (
        <div className="card mb-6 p-5">
          <h2 className="text-lg font-semibold text-gray-900">{copy.sharedChannels.createTitle}</h2>
          <form className="mt-4 space-y-4" onSubmit={(event) => void handleCreate(event)}>
            <div>
              <label htmlFor="shared-channel-name" className="label">
                {copy.sharedChannels.fields.name}
              </label>
              <input
                id="shared-channel-name"
                name="name"
                className="input"
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="shared-channel-kind" className="label">
                {copy.sharedChannels.fields.kind}
              </label>
              <select
                id="shared-channel-kind"
                name="kind"
                className="input"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="whatsapp">whatsapp</option>
                <option value="whatsapp_business">whatsapp_business</option>
                <option value="whatsapp_evolution">whatsapp_evolution</option>
                <option value="linq">linq</option>
                <option value="telegram">telegram</option>
                <option value="wechat_personal">wechat_personal</option>
              </select>
            </div>
            <div>
              <label htmlFor="shared-channel-agent-id" className="label">
                {copy.sharedChannels.fields.agentId}
              </label>
              <input
                id="shared-channel-agent-id"
                name="agentId"
                className="input"
                value={agentId}
                onInput={(event) => setAgentId(event.currentTarget.value)}
                required
              />
            </div>
            {evolutionCreateMode ? (
              <div>
                <label htmlFor="shared-channel-instance-name" className="label">
                  {copy.sharedChannels.fields.instanceName}
                </label>
                <input
                  id="shared-channel-instance-name"
                  name="instanceName"
                  className="input"
                  value={instanceName}
                  onInput={(event) => setInstanceName(event.currentTarget.value)}
                  required
                />
                <p className="mt-2 text-xs text-gray-500">{copy.sharedChannels.instanceNameHelp}</p>
              </div>
            ) : linqCreateMode ? (
              <div>
                <label htmlFor="shared-channel-from-number" className="label">
                  {copy.sharedChannels.fields.fromNumber}
                </label>
                <input
                  id="shared-channel-from-number"
                  name="fromNumber"
                  className="input"
                  value={fromNumber}
                  placeholder="+13213108456"
                  onInput={(event) => setFromNumber(event.currentTarget.value)}
                />
                <p className="mt-2 text-xs text-gray-500">{copy.sharedChannels.fromNumberHelp}</p>
              </div>
            ) : (
              <div>
                <label htmlFor="shared-channel-config" className="label">
                  {copy.sharedChannels.fields.config}
                </label>
                <textarea
                  id="shared-channel-config"
                  name="config"
                  className="input min-h-[120px]"
                  value={configText}
                  onInput={(event) => setConfigText(event.currentTarget.value)}
                />
              </div>
            )}
            {error ? <p className="text-sm text-red-600">{copy.common.errorPrefix}: {error}</p> : null}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? copy.common.loading : copy.sharedChannels.openCreate}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                {copy.common.cancel}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : error ? (
          <div className="px-5 py-8">
            <p className="text-sm text-red-600">
              {copy.common.errorPrefix}: {error}
            </p>
            <button
              type="button"
              className="btn-secondary mt-4"
              data-testid="retry-load"
              onClick={() => setReloadKey((current) => current + 1)}
            >
              {copy.common.retry}
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.sharedChannels.columns.name}</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.sharedChannels.columns.kind}</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.sharedChannels.columns.status}</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.sharedChannels.columns.agent}</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.sharedChannels.columns.updated}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                    {copy.common.empty}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3.5 text-gray-900">
                      <a href={buildSharedChannelDetailHref(row.id)} className="font-medium underline underline-offset-4">
                        {row.name}
                      </a>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{row.kind}</td>
                    <td className="px-5 py-3.5 text-gray-600">{row.status}</td>
                    <td className="px-5 py-3.5 text-gray-600">{row.agent?.name ?? '—'}</td>
                    <td className="px-5 py-3.5 text-gray-600">{formatDateTime(row.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
