'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import type { ApiResponse } from '../../../../../shared/src/types/api';
import { useLocale } from '../../../../components/locale-provider';
import {
  clearCokeUserAuth,
  getCokeUser,
  getCokeUserToken,
  isCokeUserSuspended,
  needsCokeEmailVerification,
  needsCokeSubscriptionRenewal,
  type CokeUser,
} from '../../../../lib/coke-user-auth';
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
  applyCokeUserWechatChannelMutationFailure,
  applyCokeUserWechatChannelMutationResult,
  applyCokeUserWechatChannelRefreshFailure,
} from '../../../../lib/coke-user-wechat-channel-machine';

type BlockedAccessState = {
  title: string;
  description: string;
  actions: Array<{ href: string; label: string }>;
};

function formatTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    template,
  );
}

function getBlockedAccessState(
  user: CokeUser | null,
  copy: ReturnType<typeof useLocale>['messages']['cokeUserPages']['bindWechat']['blocked'],
): BlockedAccessState | null {
  if (isCokeUserSuspended(user)) {
    return {
      title: copy.suspendedTitle,
      description: copy.suspendedDescription,
      actions: [],
    };
  }

  const actions: Array<{ href: string; label: string }> = [];
  if (needsCokeEmailVerification(user)) {
    actions.push({ href: '/coke/verify-email', label: copy.verifyEmail });
  }
  if (needsCokeSubscriptionRenewal(user)) {
    actions.push({ href: '/coke/renew', label: copy.renewSubscription });
  }

  if (actions.length === 0) {
    return null;
  }

  return {
    title: copy.prerequisitesTitle,
    description: copy.prerequisitesDescription,
    actions,
  };
}

export default function BindWechatPage() {
  const { locale, messages } = useLocale();
  const copy = messages.cokeUserPages.bindWechat;
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  const router = useRouter();
  const [channel, setChannel] = useState<CokeUserWechatChannelState | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [hasToken] = useState<boolean>(() => getCokeUserToken() != null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'create' | 'connect' | 'disconnect' | 'archive' | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [user] = useState<CokeUser | null>(() => getCokeUser());
  const channelRef = useRef<CokeUserWechatChannelState | null>(null);
  const busyActionRef = useRef<'create' | 'connect' | 'disconnect' | 'archive' | null>(null);
  const channelRevisionRef = useRef(0);
  const channelViewModel = useMemo(
    () => getCokeUserWechatChannelViewModel(channel, copy.viewModel),
    [channel, copy.viewModel],
  );
  const blockedAccessState = useMemo(() => getBlockedAccessState(user, copy.blocked), [copy.blocked, user]);
  const userName = user?.display_name ?? '';

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
        const message = copy.loadFailure.title;
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

      const message = copy.loadFailure.title;
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
  }, [copy.errorCard.fallbackDescription, copy.loadFailure.title]);

  useEffect(() => {
    if (!hasToken) {
      router.replace('/coke/login');
      setLoading(false);
      return;
    }

    if (blockedAccessState != null) {
      setLoading(false);
      return;
    }

    void refreshChannel();
  }, [blockedAccessState, hasToken, refreshChannel, router]);

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
          copy.errorCard.fallbackDescription,
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
        copy.errorCard.fallbackDescription,
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

  if (!hasToken) {
    return null;
  }

  if (blockedAccessState != null) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-700">
          {copy.blocked.accessEyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{blockedAccessState.title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">{blockedAccessState.description}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {blockedAccessState.actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              {action.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            {messages.common.signOutLabel}
          </button>
        </div>
      </section>
    );
  }

  if (loadError && !channel) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.loadFailure.title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">{loadError}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void refreshChannel()}
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {messages.common.retryLabel}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            {messages.common.signOutLabel}
          </button>
        </div>
      </section>
    );
  }

  if (loading && !channel) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-slate-50 p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.loading.title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">{copy.loading.description}</p>
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
          {userName && channel.status === 'connected'
            ? ` ${formatTemplate(copy.connectedCard.accountOwnershipSuffix, { name: userName })}`
            : ''}
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
                ? copy.statusDescriptions.missing
                : channel.status === 'archived'
                  ? copy.statusDescriptions.archived
                  : copy.statusDescriptions.disconnected}
            </p>
          </div>
        ) : null}

        {channel.status === 'pending' ? (
          <div className="mt-8 flex min-h-80 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-6">
            {qrDataUrl ? (
              <Image
                src={qrDataUrl}
                alt={copy.qr.imageAlt}
                width={288}
                height={288}
                unoptimized
                className="h-72 w-72 rounded-2xl border border-slate-200"
              />
            ) : (
              <p className="text-sm text-slate-500">{copy.qr.preparing}</p>
            )}
          </div>
        ) : null}

        {channel.status === 'pending' && channel.expires_at ? (
          <p className="mt-4 text-xs text-slate-500">
            {copy.qr.expiresPrefix} {normalizeExpiresAt(channel.expires_at).toLocaleString(dateLocale)}.
          </p>
        ) : null}

        {channel.status === 'pending' && refreshError ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {refreshError} {copy.qr.activeSuffix}
          </p>
        ) : null}

        {channel.status === 'connected' ? (
          <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-700">
              {copy.connectedCard.eyebrow}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {channel.masked_identity
                ? formatTemplate(copy.connectedCard.descriptionWithIdentity, {
                    identity: channel.masked_identity,
                  })
                : copy.connectedCard.descriptionWithoutIdentity}
            </p>
          </div>
        ) : null}

        {channel.status === 'error' ? (
          <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-red-700">
              {copy.errorCard.eyebrow}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {copy.errorCard.fallbackDescription}
            </p>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-8">
        <h2 className="text-lg font-semibold text-slate-950">{copy.nextSteps.title}</h2>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
          {channel.status === 'missing' ? <li>{copy.nextSteps.missing}</li> : null}
          {channel.status === 'disconnected' ? <li>{copy.nextSteps.disconnected}</li> : null}
          {channel.status === 'pending' ? <li>{copy.nextSteps.pending}</li> : null}
          {channel.status === 'connected' ? <li>{copy.nextSteps.connected}</li> : null}
          {channel.status === 'error' ? <li>{copy.nextSteps.error}</li> : null}
          {channel.status === 'archived' ? <li>{copy.nextSteps.archived}</li> : null}
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          {channel.status === 'missing' ? (
            <button
              type="button"
              onClick={handleCreateChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'create' ? copy.busyActions.create : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'disconnected' ? (
            <button
              type="button"
              onClick={handleConnectChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'connect' ? copy.busyActions.connect : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'pending' ? (
            <button
              type="button"
              onClick={handleConnectChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'connect' ? copy.busyActions.refresh : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'connected' ? (
            <button
              type="button"
              onClick={handleDisconnectChannel}
              disabled={busyAction != null}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busyAction === 'disconnect'
                ? copy.busyActions.disconnect
                : channelViewModel.primaryActionLabel}
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
                {busyAction === 'connect'
                  ? copy.busyActions.reconnect
                  : channelViewModel.primaryActionLabel}
              </button>
              <button
                type="button"
                onClick={handleArchiveChannel}
                disabled={busyAction != null}
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                {busyAction === 'archive'
                  ? copy.busyActions.archive
                  : channelViewModel.secondaryActionLabel}
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
              {busyAction === 'create' ? copy.busyActions.create : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            {messages.common.signOutLabel}
          </button>
        </div>

        <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          {copy.accountPrompt}{' '}
          <Link href="/coke/register" className="font-medium text-slate-950 underline underline-offset-4">
            {copy.createAccount}
          </Link>
        </div>
      </div>
    </section>
  );
}
