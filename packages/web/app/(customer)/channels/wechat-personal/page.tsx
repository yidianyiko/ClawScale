'use client';

import { Suspense, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { clearCustomerAuth } from '../../../../lib/customer-auth';
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

type BindWechatCopy = ReturnType<typeof useLocale>['messages']['customerPages']['bindWechat'];

const primaryButtonClass = 'customer-channel-page__button customer-channel-page__button--primary';
const secondaryButtonClass = 'customer-channel-page__button customer-channel-page__button--secondary';

function formatTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    template,
  );
}

function ChannelSetupCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="coke-site customer-channel-page">
      <section className="auth-card customer-channel-page__card">
        {eyebrow ? <p className="auth-card__eyebrow">{eyebrow}</p> : null}
        <h1 className="auth-card__title">{title}</h1>
        {description ? <p className="auth-card__desc">{description}</p> : null}
        {children}
      </section>
    </div>
  );
}

function getChannelStatusDescription(
  status: CokeUserWechatChannelState['status'],
  copy: BindWechatCopy,
): string | null {
  if (status === 'missing') {
    return copy.statusDescriptions.missing;
  }

  if (status === 'archived') {
    return copy.statusDescriptions.archived;
  }

  if (status === 'disconnected') {
    return copy.statusDescriptions.disconnected;
  }

  return null;
}

function getChannelNextSteps(
  status: CokeUserWechatChannelState['status'],
  copy: BindWechatCopy,
): string[] {
  if (status === 'missing') {
    return [copy.nextSteps.missing];
  }

  if (status === 'disconnected') {
    return [copy.nextSteps.disconnected];
  }

  if (status === 'pending') {
    return [copy.nextSteps.pending];
  }

  if (status === 'connected') {
    return [copy.nextSteps.connected];
  }

  if (status === 'error') {
    return [copy.nextSteps.error];
  }

  if (status === 'archived') {
    return [copy.nextSteps.archived];
  }

  return [];
}

function getBlockedAccessState(
  user: CokeUser | null,
  copy: ReturnType<typeof useLocale>['messages']['customerPages']['bindWechat']['blocked'],
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
    actions.push({ href: '/auth/verify-email', label: copy.verifyEmail });
  }
  if (needsCokeSubscriptionRenewal(user)) {
    actions.push({ href: '/coke/payment', label: copy.renewSubscription });
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

function CustomerWechatPersonalPageContent() {
  const { locale, messages } = useLocale();
  const copy = messages.customerPages.bindWechat;
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  const router = useRouter();
  const searchParams = useSearchParams();
  const compatibilityRedirect = searchParams.get('next') === 'renew' ? '/coke/payment' : null;
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
  }, [copy.loadFailure.title]);

  useEffect(() => {
    if (compatibilityRedirect) {
      router.replace(compatibilityRedirect);
      setLoading(false);
      return;
    }

    if (!hasToken) {
      router.replace('/auth/login');
      setLoading(false);
      return;
    }

    if (blockedAccessState != null) {
      setLoading(false);
      return;
    }

    void refreshChannel();
  }, [blockedAccessState, compatibilityRedirect, hasToken, refreshChannel, router]);

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
    clearCustomerAuth();
    router.replace('/auth/login');
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

  if (compatibilityRedirect) {
    return null;
  }

  if (!hasToken) {
    return null;
  }

  if (blockedAccessState != null) {
    return (
      <ChannelSetupCard
        eyebrow={copy.blocked.accessEyebrow}
        title={blockedAccessState.title}
        description={blockedAccessState.description}
      >
        <div className="customer-channel-page__section customer-channel-page__actions">
          <div className="customer-channel-page__button-row">
            {blockedAccessState.actions.map((action) => (
              <Link key={action.href} href={action.href} className={primaryButtonClass}>
                {action.label}
              </Link>
            ))}
            <button type="button" onClick={handleSignOut} className={secondaryButtonClass}>
              {messages.common.signOutLabel}
            </button>
          </div>
        </div>
      </ChannelSetupCard>
    );
  }

  if (loadError && !channel) {
    return (
      <ChannelSetupCard title={copy.loadFailure.title} description={loadError}>
        <div className="customer-channel-page__section customer-channel-page__actions">
          <div className="customer-channel-page__button-row">
            <button type="button" onClick={() => void refreshChannel()} className={primaryButtonClass}>
              {messages.common.retryLabel}
            </button>
            <button type="button" onClick={handleSignOut} className={secondaryButtonClass}>
              {messages.common.signOutLabel}
            </button>
          </div>
        </div>
      </ChannelSetupCard>
    );
  }

  if (loading && !channel) {
    return (
      <ChannelSetupCard title={copy.loading.title} description={copy.loading.description} />
    );
  }

  if (!channel) {
    return null;
  }

  const statusDescription = getChannelStatusDescription(channel.status, copy);
  const nextSteps = getChannelNextSteps(channel.status, copy);

  return (
    <ChannelSetupCard
      eyebrow={channelViewModel.eyebrow}
      title={channelViewModel.title}
      description={`${channelViewModel.description}${
        userName && channel.status === 'connected'
          ? ` ${formatTemplate(copy.connectedCard.accountOwnershipSuffix, { name: userName })}`
          : ''
      }`}
    >
      {actionError ? (
        <div className="auth-alert auth-alert--warning customer-channel-page__alert">{actionError}</div>
      ) : null}

      {statusDescription ? (
        <div className="customer-channel-page__section">
          <div className="customer-channel-page__surface customer-channel-page__surface--neutral">
            <p className="customer-channel-page__surface-copy">{statusDescription}</p>
          </div>
        </div>
      ) : null}

      {channel.status === 'pending' ? (
        <div className="customer-channel-page__section">
          <div className="customer-channel-page__qr-frame">
            {qrDataUrl ? (
              <Image
                src={qrDataUrl}
                alt={copy.qr.imageAlt}
                width={288}
                height={288}
                unoptimized
                className="customer-channel-page__qr-image"
              />
            ) : (
              <p className="customer-channel-page__surface-copy">{copy.qr.preparing}</p>
            )}
          </div>

          {channel.expires_at ? (
            <p className="customer-channel-page__meta">
              {copy.qr.expiresPrefix} {normalizeExpiresAt(channel.expires_at).toLocaleString(dateLocale)}.
            </p>
          ) : null}

          {refreshError ? (
            <p className="auth-alert auth-alert--warning customer-channel-page__alert">
              {refreshError} {copy.qr.activeSuffix}
            </p>
          ) : null}
        </div>
      ) : null}

      {channel.status === 'connected' ? (
        <div className="customer-channel-page__section">
          <div className="customer-channel-page__surface customer-channel-page__surface--success">
            <p className="customer-channel-page__surface-eyebrow">{copy.connectedCard.eyebrow}</p>
            <p className="customer-channel-page__surface-copy">
              {channel.masked_identity
                ? formatTemplate(copy.connectedCard.descriptionWithIdentity, {
                    identity: channel.masked_identity,
                  })
                : copy.connectedCard.descriptionWithoutIdentity}
            </p>
          </div>
        </div>
      ) : null}

      {channel.status === 'error' ? (
        <div className="customer-channel-page__section">
          <div className="customer-channel-page__surface customer-channel-page__surface--danger">
            <p className="customer-channel-page__surface-eyebrow">{copy.errorCard.eyebrow}</p>
            <p className="customer-channel-page__surface-copy">{copy.errorCard.fallbackDescription}</p>
          </div>
        </div>
      ) : null}

      <div className="customer-channel-page__section">
        <p className="customer-channel-page__section-title">{copy.nextSteps.title}</p>
        <ul className="customer-channel-page__steps">
          {nextSteps.map((step) => (
            <li key={step} className="customer-channel-page__step">
              {step}
            </li>
          ))}
        </ul>
      </div>

      <div className="customer-channel-page__section customer-channel-page__actions">
        <div className="customer-channel-page__button-row">
          {channel.status === 'missing' ? (
            <button
              type="button"
              onClick={handleCreateChannel}
              disabled={busyAction != null}
              className={primaryButtonClass}
            >
              {busyAction === 'create' ? copy.busyActions.create : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'disconnected' ? (
            <button
              type="button"
              onClick={handleConnectChannel}
              disabled={busyAction != null}
              className={primaryButtonClass}
            >
              {busyAction === 'connect' ? copy.busyActions.connect : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'pending' ? (
            <button
              type="button"
              onClick={handleConnectChannel}
              disabled={busyAction != null}
              className={primaryButtonClass}
            >
              {busyAction === 'connect' ? copy.busyActions.refresh : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          {channel.status === 'connected' ? (
            <button
              type="button"
              onClick={handleDisconnectChannel}
              disabled={busyAction != null}
              className={primaryButtonClass}
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
                className={primaryButtonClass}
              >
                {busyAction === 'connect'
                  ? copy.busyActions.reconnect
                  : channelViewModel.primaryActionLabel}
              </button>
              <button
                type="button"
                onClick={handleArchiveChannel}
                disabled={busyAction != null}
                className={secondaryButtonClass}
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
              className={primaryButtonClass}
            >
              {busyAction === 'create' ? copy.busyActions.create : channelViewModel.primaryActionLabel}
            </button>
          ) : null}

          <button type="button" onClick={handleSignOut} className={secondaryButtonClass}>
            {messages.common.signOutLabel}
          </button>
        </div>
      </div>

      <div className="customer-channel-page__section customer-channel-page__footer">
        <p className="customer-channel-page__footer-copy">
          {copy.accountPrompt}{' '}
          <Link href="/auth/register" className="customer-channel-page__footer-link">
            {copy.createAccount}
          </Link>
        </p>
      </div>
    </ChannelSetupCard>
  );
}

export default function CustomerWechatPersonalPage() {
  return (
    <Suspense fallback={null}>
      <CustomerWechatPersonalPageContent />
    </Suspense>
  );
}
