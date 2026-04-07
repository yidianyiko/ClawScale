'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { clearCokeUserAuth, getCokeUser, getCokeUserToken } from '../../../../lib/coke-user-auth';
import type { ApiResponse } from '@clawscale/shared';
import {
  archiveCokeUserWechatChannel,
  connectCokeUserWechatChannel,
  createCokeUserWechatChannel,
  disconnectCokeUserWechatChannel,
  getCokeUserWechatChannelStatus,
  getCokeUserWechatChannelViewModel,
  type CokeUserWechatChannelState,
} from '../../../../lib/coke-user-wechat-channel';
import {
  applyCokeUserWechatChannelMutationResult,
  applyCokeUserWechatChannelMutationFailure,
  applyCokeUserWechatChannelRefreshFailure,
} from '../../../../lib/coke-user-wechat-channel-machine';

export default function BindWechatPage() {
  const router = useRouter();
  const [channel, setChannel] = useState<CokeUserWechatChannelState | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'create' | 'connect' | 'disconnect' | 'archive' | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const channelRef = useRef<CokeUserWechatChannelState | null>(null);
  const busyActionRef = useRef<'create' | 'connect' | 'disconnect' | 'archive' | null>(null);
  const channelRevisionRef = useRef(0);
  const channelViewModel = useMemo(() => getCokeUserWechatChannelViewModel(channel), [channel]);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  function normalizeExpiresAt(expiresAt: number): Date {
    return new Date(expiresAt < 1_000_000_000_000 ? expiresAt * 1000 : expiresAt);
  }

  const refreshChannel = useCallback(async (options?: { silent?: boolean }) => {
    const requestRevision = channelRevisionRef.current;

    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const res = await getCokeUserWechatChannelStatus();
      if (requestRevision !== channelRevisionRef.current) {
        return;
      }

      if (!res.ok) {
        const message = res.error ?? 'Unable to load your personal WeChat channel right now.';
        if (channelRef.current == null) {
          setLoadError(message);
          setRefreshError(null);
          setActionError(null);
          setChannel(null);
        } else {
          const next = applyCokeUserWechatChannelRefreshFailure(channelRef.current, message);
          setChannel(next.channel);
          setRefreshError(next.transientError);
        }
        return;
      }

      setLoadError(null);
      setRefreshError(null);
      channelRevisionRef.current += 1;
      setActionError(null);
      setChannel(res.data);
    } catch {
      if (requestRevision !== channelRevisionRef.current) {
        return;
      }

      const message = 'Unable to load your personal WeChat channel right now.';
      if (channelRef.current == null) {
        setLoadError(message);
        setRefreshError(null);
        setActionError(null);
        setChannel(null);
      } else {
        const next = applyCokeUserWechatChannelRefreshFailure(channelRef.current, message);
        setChannel(next.channel);
        setRefreshError(next.transientError);
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const token = getCokeUserToken();
    setHasToken(token != null);
    setUserName(getCokeUser()?.display_name ?? '');
  }, []);

  useEffect(() => {
    if (hasToken === false) {
      router.replace('/coke/login');
      setLoading(false);
      return;
    }

    if (hasToken !== true) {
      return;
    }

    void refreshChannel();
  }, [hasToken, refreshChannel, router]);

  useEffect(() => {
    if (channel?.status !== 'pending' || !channel.connect_url) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(channel.connect_url)
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
        }
      });

    const timer = window.setInterval(() => {
      void refreshChannel({ silent: true });
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [channel?.connect_url, channel?.status, refreshChannel]);

  function handleSignOut() {
    clearCokeUserAuth();
    router.replace('/coke/login');
  }

  async function runAction(
    action: 'create' | 'connect' | 'disconnect' | 'archive',
    operation: () => Promise<ApiResponse<CokeUserWechatChannelState>>,
  ) {
    if (busyActionRef.current != null) {
      return;
    }

    const currentChannel = channel;
    busyActionRef.current = action;
    setBusyAction(action);

    try {
      const res = await operation();
      if (!res.ok) {
        setRefreshError(null);
        const next = applyCokeUserWechatChannelMutationFailure(
          currentChannel,
          res.error ?? 'The WeChat channel request failed.',
        );
        channelRevisionRef.current += 1;
        setActionError(next.actionError);
        setChannel(next.channel);
        return;
      }

      setRefreshError(null);
      channelRevisionRef.current += 1;
      setActionError(null);
      setChannel(applyCokeUserWechatChannelMutationResult(res.data));
    } catch {
      setRefreshError(null);
      const next = applyCokeUserWechatChannelMutationFailure(
        currentChannel,
        'Unable to update your personal WeChat channel right now.',
      );
      channelRevisionRef.current += 1;
      setActionError(next.actionError);
      setChannel(next.channel);
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  }

  async function handleCreateChannel() {
    await runAction('create', () => createCokeUserWechatChannel());
  }

  async function handleConnectChannel() {
    await runAction('connect', () => connectCokeUserWechatChannel());
  }

  async function handleDisconnectChannel() {
    await runAction('disconnect', () => disconnectCokeUserWechatChannel());
  }

  async function handleArchiveChannel() {
    await runAction('archive', () => archiveCokeUserWechatChannel());
  }

  if (hasToken === false) {
    return null;
  }

  if (loadError && !channel) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Unable to load your WeChat channel</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">{loadError}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void refreshChannel()}
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  if (loading && !channel) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-slate-50 p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Loading your WeChat channel</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">
          We are checking the personal channel attached to this Coke account.
        </p>
      </section>
    );
  }

  if (!channel) {
    return null;
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1.35fr_0.95fr]">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">{channelViewModel.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          {channelViewModel.title}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700">
          {channelViewModel.description}
          {userName && channel.status === 'connected' ? ` ${userName}, this belongs to your Coke account.` : ''}
        </p>

        {actionError ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {actionError}
          </div>
        ) : null}

        {channel.status === 'missing' || channel.status === 'disconnected' || channel.status === 'archived' ? (
          <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-6">
            <p className="text-sm leading-6 text-slate-600">
              {channel.status === 'missing'
                ? 'Create the channel first, then start a QR session for your own WeChat login.'
                : channel.status === 'archived'
                  ? 'Archived channels do not route messages. Create a fresh channel to start over.'
                  : 'The channel exists but is not connected yet. Start a QR session to bring it online.'}
            </p>
          </div>
        ) : null}

        {channel.status === 'pending' ? (
          <div className="mt-8 flex min-h-80 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-6">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Personal Coke WeChat login QR"
                className="h-72 w-72 rounded-2xl border border-slate-200"
              />
            ) : (
              <p className="text-sm text-slate-500">Preparing your QR code...</p>
            )}
          </div>
        ) : null}

        {channel.status === 'pending' && channel.expires_at ? (
          <p className="mt-4 text-xs text-slate-500">
            This QR session expires at {normalizeExpiresAt(channel.expires_at).toLocaleString()}.
          </p>
        ) : null}

        {channel.status === 'pending' && refreshError ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {refreshError} The current QR session is still active.
          </p>
        ) : null}

        {channel.status === 'connected' ? (
          <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-700">Connected</p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {channel.masked_identity
                ? `WeChat ${channel.masked_identity} is connected to this Coke account.`
                : 'Your personal WeChat channel is connected and ready.'}
            </p>
          </div>
        ) : null}

        {channel.status === 'error' ? (
          <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-red-700">Connection error</p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {channel.error ?? 'The last connect attempt failed. Retry or archive this channel.'}
            </p>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-8">
        <h2 className="text-lg font-semibold text-slate-950">What you can do next</h2>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
          {channel.status === 'missing' ? <li>Create your personal WeChat channel for this account.</li> : null}
          {channel.status === 'disconnected' ? <li>Start a QR login session to connect the existing channel.</li> : null}
          {channel.status === 'pending' ? <li>Scan the QR code with the WeChat account you want to own this channel.</li> : null}
          {channel.status === 'connected' ? <li>Disconnect the channel when you want to take it offline.</li> : null}
          {channel.status === 'error' ? <li>Retry the connect flow or archive the broken channel.</li> : null}
          {channel.status === 'archived' ? <li>Create a fresh channel if you want to start over.</li> : null}
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          {channel.status === 'missing' ? (
            <button
              type="button"
              onClick={handleCreateChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'create' ? 'Creating...' : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'disconnected' ? (
            <button
              type="button"
              onClick={handleConnectChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'connect' ? 'Connecting...' : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'pending' ? (
            <button
              type="button"
              onClick={handleConnectChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'connect' ? 'Refreshing...' : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'connected' ? (
            <button
              type="button"
              onClick={handleDisconnectChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'disconnect' ? 'Disconnecting...' : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'error' ? (
            <>
              <button
                type="button"
                onClick={handleConnectChannel}
                disabled={busyAction != null}
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {busyAction === 'connect' ? 'Reconnecting...' : channelViewModel.primaryActionLabel}
              </button>
              <button
                type="button"
                onClick={handleArchiveChannel}
                disabled={busyAction != null}
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                {busyAction === 'archive'
                  ? 'Archiving...'
                  : channelViewModel.secondaryActionLabel ?? 'Archive channel'}
              </button>
            </>
          ) : null}

          {channel.status === 'archived' ? (
            <button
              type="button"
              onClick={handleCreateChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'create' ? 'Creating...' : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            Sign out
          </button>
        </div>

        <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          Need an account?{' '}
          <Link href="/coke/register" className="font-medium text-slate-950 underline underline-offset-4">
            Create one
          </Link>
        </div>
      </div>
    </section>
  );
}
