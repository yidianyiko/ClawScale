'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Image from 'next/image';

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

const CHANNEL_LABELS: Record<string, string> = {
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  whatsapp_business: 'WhatsApp Business',
  telegram: 'Telegram',
  slack: 'Slack',
  line: 'LINE',
  signal: 'Signal',
  teams: 'Microsoft Teams',
  matrix: 'Matrix',
  web: 'Web Chat',
};

const CHANNEL_INSTRUCTIONS: Record<string, string> = {
  discord: 'Click the link below to add the bot to your Discord server, then send it a message.',
  whatsapp: 'Scan the QR code or message the number below to start chatting.',
  whatsapp_business: 'Click the link below to start a WhatsApp conversation.',
  telegram: 'Click the link below to open a chat with the bot in Telegram.',
  slack: 'Click the link below to install the app in your Slack workspace.',
  line: 'Add the bot as a friend using the link below.',
  signal: 'Message the number below on Signal to start chatting.',
  teams: 'Click the link below to add the bot to Microsoft Teams.',
  matrix: 'Join the room using the link below.',
  web: 'Click the link below to start chatting in your browser.',
};

export default function OnboardPage() {
  const params = useSearchParams();
  const palmosUserId = params.get('palmosUserId');
  const selectedChannel = params.get('channel');
  const tenantSlug = params.get('tenant');

  const [data, setData] = useState<OnboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? '';

  useEffect(() => {
    if (!tenantSlug) {
      setError('Missing tenant parameter');
      setLoading(false);
      return;
    }

    fetch(`${apiBase}/api/onboard/channels?tenantSlug=${tenantSlug}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      })
      .catch(() => setError('Failed to load channels'))
      .finally(() => setLoading(false));
  }, [tenantSlug, apiBase]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-lg shadow p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">Setup Error</h1>
          <p className="text-gray-500">{error ?? 'Something went wrong'}</p>
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
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <Image src="/logo.png" alt="ClawScale" width={48} height={48} className="mx-auto mb-4" />
          <h1 className="text-2xl font-semibold">Connect to {data.tenantName}</h1>
          <p className="text-gray-500 mt-2">
            {selectedChannel
              ? `Set up ${CHANNEL_LABELS[selectedChannel] ?? selectedChannel} to start chatting.`
              : 'Choose a channel to start chatting with your AI assistant.'}
          </p>
          {palmosUserId && (
            <p className="text-xs text-gray-400 mt-1">
              Palmos account linked
            </p>
          )}
        </div>

        {channels.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-500">
              {selectedChannel
                ? `${CHANNEL_LABELS[selectedChannel] ?? selectedChannel} is not available yet. Ask your admin to set it up.`
                : 'No channels are available yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {channels.map((ch) => (
              <div key={ch.id} className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-medium mb-1">
                  {CHANNEL_LABELS[ch.type] ?? ch.type}
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  {CHANNEL_INSTRUCTIONS[ch.type] ?? 'Follow the link below to connect.'}
                </p>
                {ch.connectUrl ? (
                  <a
                    href={ch.connectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Connect {CHANNEL_LABELS[ch.type] ?? ch.type}
                  </a>
                ) : (
                  <p className="text-sm text-gray-400">
                    Contact your admin for connection details.
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
