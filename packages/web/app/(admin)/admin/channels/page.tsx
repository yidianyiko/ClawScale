'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocale } from '../../../../components/locale-provider';
import { adminApi, type AdminChannelRow, type AdminPagedResult } from '../../../../lib/admin-api';
import { getAdminCopy } from '../../../../lib/admin-copy';
import { formatDateTime } from '../../../../lib/utils';

const PAGE_SIZE = 10;
const CHANNEL_STATUS_VALUES = ['connected', 'disconnected', 'pending', 'error', 'archived'];
const CHANNEL_KIND_VALUES = [
  'whatsapp',
  'telegram',
  'slack',
  'discord',
  'instagram',
  'facebook',
  'line',
  'signal',
  'teams',
  'matrix',
  'web',
  'wechat_work',
  'whatsapp_business',
  'wechat_personal',
];

function getPagingSummary(total: number, offset: number, visibleCount: number, summarize: (from: number, to: number, total: number) => string) {
  if (total === 0 || visibleCount === 0) {
    return summarize(0, 0, total);
  }

  return summarize(offset + 1, offset + visibleCount, total);
}

export default function AdminChannelsPage() {
  const { locale } = useLocale();
  const copy = getAdminCopy(locale);
  const [rows, setRows] = useState<AdminChannelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadChannels() {
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      if (status) {
        params.set('status', status);
      }

      if (kind) {
        params.set('kind', kind);
      }

      const response = await adminApi.get<AdminPagedResult<AdminChannelRow>>(
        '/api/admin/channels?' + params.toString(),
      );

      if (!active) {
        return;
      }

      if (!response.ok) {
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }

      setRows(response.data.rows);
      setTotal(response.data.total);
      setLoading(false);
    }

    void loadChannels();
    return () => {
      active = false;
    };
  }, [kind, offset, status]);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">{copy.channels.title}</h1>
        <p className="mt-1 text-gray-500">{copy.channels.subtitle}</p>
      </div>

      <div className="card mb-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="status-filter" className="label">
              {copy.channels.filters.status}
            </label>
            <select
              id="status-filter"
              name="status"
              className="input"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{copy.channels.filters.allStatuses}</option>
              {CHANNEL_STATUS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="kind-filter" className="label">
              {copy.channels.filters.kind}
            </label>
            <select
              id="kind-filter"
              name="kind"
              className="input"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{copy.channels.filters.allKinds}</option>
              {CHANNEL_KIND_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.channels.columns.name}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.channels.columns.kind}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.channels.columns.status}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.channels.columns.customerId}</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.channels.columns.updated}</th>
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
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-gray-400">{row.id}</div>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600">{row.kind}</td>
                      <td className="px-5 py-3.5 text-gray-600">{row.status}</td>
                      <td className="px-5 py-3.5 text-gray-600">{row.customerId ?? '—'}</td>
                      <td className="px-5 py-3.5 text-gray-600">{formatDateTime(row.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-sm text-gray-500">
              <span>{getPagingSummary(total, offset, rows.length, copy.paging.summary)}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label="Previous page"
                  disabled={offset === 0}
                  onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
                >
                  {copy.paging.previous}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label="Next page"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset((current) => current + PAGE_SIZE)}
                >
                  {copy.paging.next}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
