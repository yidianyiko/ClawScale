'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useEffectEvent, useState } from 'react';
import Image from 'next/image';
import { LocaleSwitch } from '@/components/locale-switch';
import { useLocale } from '@/components/locale-provider';
import { getDashboardCopy } from '@/lib/dashboard-copy';

interface ChannelInfo {
  id: string;
  type: string;
  name: string;
  connectUrl: string | null;
}

interface OnboardData {
  tenantName: string;
  channels: ChannelInfo[];
}

function OnboardPageContent() {
  const params = useSearchParams();
  const palmosUserId = params.get('palmosUserId');
  const selectedChannel = params.get('channel');
  const tenantSlug = params.get('tenant');
  const { locale } = useLocale();

  const [data, setData] = useState<OnboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? '';
  const copy = getDashboardCopy(locale);
  const getLocalizedMessages = useEffectEvent(() => ({
    missingTenant: copy.onboard.missingTenant,
    failedToLoadChannels: copy.onboard.failedToLoadChannels,
    unexpectedError: copy.onboard.unexpectedError,
  }));

  useEffect(() => {
    if (!tenantSlug) {
      setError(getLocalizedMessages().missingTenant);
      setLoading(false);
      return;
    }

    fetch(`${apiBase}/api/onboard/channels?tenantSlug=${tenantSlug}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          setError(getLocalizedMessages().unexpectedError);
        } else {
          setData(result);
        }
      })
      .catch(() => setError(getLocalizedMessages().failedToLoadChannels))
      .finally(() => setLoading(false));
  }, [tenantSlug, apiBase, getLocalizedMessages]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-500">{copy.onboard.loading}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-lg shadow p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">{copy.onboard.setupError}</h1>
          <p className="text-gray-500">{error ?? copy.onboard.unexpectedError}</p>
        </div>
      </div>
    );
  }

  // Filter to selected channel if specified
  const channels = selectedChannel
    ? data.channels.filter((ch) => ch.type === selectedChannel)
    : data.channels;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto mb-4 flex max-w-lg justify-end">
        <LocaleSwitch />
      </div>
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <Image src="/logo.png" alt="ClawScale" width={48} height={48} className="mx-auto mb-4" />
          <h1 className="text-2xl font-semibold">{copy.onboard.connectTo(data.tenantName)}</h1>
          <p className="text-gray-500 mt-2">
            {selectedChannel
              ? copy.onboard.setupSelectedChannel(copy.onboard.channelLabels[selectedChannel] ?? selectedChannel)
              : copy.onboard.chooseChannel}
          </p>
          {palmosUserId && (
            <p className="text-xs text-gray-400 mt-1">
              {copy.onboard.palmosLinked}
            </p>
          )}
        </div>

        {channels.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-500">
              {selectedChannel
                ? copy.onboard.channelUnavailable(copy.onboard.channelLabels[selectedChannel] ?? selectedChannel)
                : copy.onboard.noChannels}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {channels.map((ch) => (
              <div key={ch.id} className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium mb-1">
                  {copy.onboard.channelLabels[ch.type] ?? ch.type}
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  {copy.onboard.channelInstructions[ch.type] ?? copy.onboard.fallbackInstruction}
                </p>
                {ch.connectUrl ? (
                  <a
                    href={ch.connectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {copy.onboard.connect(copy.onboard.channelLabels[ch.type] ?? ch.type)}
                  </a>
                ) : (
                  <p className="text-sm text-gray-400">
                    {copy.onboard.contactAdmin}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OnboardPageFallback() {
  const { locale } = useLocale();
  const copy = getDashboardCopy(locale);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-lg text-gray-500">{copy.onboard.loading}</p>
    </div>
  );
}

export default function OnboardPage() {
  return (
    <Suspense fallback={<OnboardPageFallback />}>
      <OnboardPageContent />
    </Suspense>
  );
}
