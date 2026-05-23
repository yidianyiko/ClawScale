'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocale } from '../../../../components/locale-provider';
import {
  acceptCustomerFriendRequest,
  cancelCustomerFriendRequest,
  disableCustomerFriendLink,
  getCustomerFriendLink,
  listCustomerFriendRequests,
  listCustomerFriends,
  rejectCustomerFriendRequest,
  removeCustomerFriend,
  resetCustomerFriendLink,
  type CustomerFriend,
  type CustomerFriendLink,
  type CustomerFriendRequest,
} from '../../../../lib/customer-friends';

const AUTH_ERRORS = new Set(['invalid_or_expired_token', 'unauthorized', 'account_not_found', 'claim_inactive']);
const LOGIN_NEXT_PATH = '/auth/login?next=/account/friends';

type FriendCopy = ReturnType<typeof useLocale>['messages']['customerPages']['friends'];
type RequestAction = 'accept' | 'reject' | 'cancel';

function statusLabel(copy: FriendCopy, status: CustomerFriendRequest['status']) {
  return copy[status] ?? status;
}

function RequestList({
  copy,
  emptyCopy,
  requests,
  kind,
  actionPending,
  onAction,
}: {
  copy: FriendCopy;
  emptyCopy: string;
  requests: CustomerFriendRequest[];
  kind: CustomerFriendRequest['direction'];
  actionPending: boolean;
  onAction: (action: RequestAction, requestId: string) => void;
}) {
  if (requests.length === 0) {
    return <p className="customer-friends-empty">{emptyCopy}</p>;
  }

  return (
    <div className="customer-friends-list">
      {requests.map((request) => (
        <article className="customer-friend-row" key={request.id}>
          <div>
            <strong>{request.counterpartAccountId || copy.unknownFriend}</strong>
            <span>{statusLabel(copy, request.status)}</span>
          </div>
          {request.status === 'pending' ? (
            <div className="customer-friend-row__actions">
              {kind === 'incoming' ? (
                <>
                  <button
                    type="button"
                    className="customer-action customer-action--secondary"
                    onClick={() => onAction('accept', request.id)}
                    disabled={actionPending}
                  >
                    {copy.accept}
                  </button>
                  <button
                    type="button"
                    className="customer-action customer-action--secondary"
                    onClick={() => onAction('reject', request.id)}
                    disabled={actionPending}
                  >
                    {copy.reject}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="customer-action customer-action--secondary"
                  onClick={() => onAction('cancel', request.id)}
                  disabled={actionPending}
                >
                  {copy.cancelRequest}
                </button>
              )}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export default function CustomerFriendsPage() {
  const { replace } = useRouter();
  const { messages } = useLocale();
  const copy = messages.customerPages.friends;
  const [friendLink, setFriendLink] = useState<CustomerFriendLink | null>(null);
  const [requests, setRequests] = useState<CustomerFriendRequest[]>([]);
  const [friends, setFriends] = useState<CustomerFriend[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestIdRef = useRef(0);

  const incomingRequests = useMemo(
    () => requests.filter((request) => request.direction === 'incoming'),
    [requests],
  );
  const outgoingRequests = useMemo(
    () => requests.filter((request) => request.direction === 'outgoing'),
    [requests],
  );

  const loadData = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError('');

    try {
      const [linkRes, requestsRes, friendsRes] = await Promise.all([
        getCustomerFriendLink(),
        listCustomerFriendRequests(),
        listCustomerFriends(),
      ]);
      if (requestId !== requestIdRef.current) {
        return false;
      }
      for (const res of [linkRes, requestsRes, friendsRes]) {
        if (!res.ok) {
          if (AUTH_ERRORS.has(res.error)) {
            replace(LOGIN_NEXT_PATH);
            return false;
          }
          setError(copy.loadFailure);
          return false;
        }
      }
      setFriendLink(linkRes.data);
      setRequests(requestsRes.data);
      setFriends(friendsRes.data);
      return true;
    } catch {
      if (requestId === requestIdRef.current) {
        setError(copy.loadFailure);
      }
      return false;
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [copy.loadFailure, replace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function copyLink() {
    if (!friendLink) {
      return;
    }
    setError('');
    setNotice('');
    try {
      await navigator.clipboard.writeText(friendLink.url);
      setNotice(copy.copied);
    } catch {
      setError(copy.actionFailure);
    }
  }

  async function runRequestAction(action: RequestAction, requestId: string) {
    setActionPending(true);
    setError('');
    setNotice('');
    try {
      const res =
        action === 'accept'
          ? await acceptCustomerFriendRequest(requestId)
          : action === 'reject'
            ? await rejectCustomerFriendRequest(requestId)
            : await cancelCustomerFriendRequest(requestId);
      if (!res.ok) {
        if (AUTH_ERRORS.has(res.error)) {
          replace(LOGIN_NEXT_PATH);
          return;
        }
        setError(copy.actionFailure);
        return;
      }
      await loadData();
    } catch {
      setError(copy.actionFailure);
    } finally {
      setActionPending(false);
    }
  }

  async function resetLink() {
    setActionPending(true);
    setError('');
    setNotice('');
    try {
      const res = await resetCustomerFriendLink();
      if (!res.ok) {
        if (AUTH_ERRORS.has(res.error)) {
          replace(LOGIN_NEXT_PATH);
          return;
        }
        setError(copy.actionFailure);
        return;
      }
      await loadData();
    } catch {
      setError(copy.actionFailure);
    } finally {
      setActionPending(false);
    }
  }

  async function disableLink() {
    setActionPending(true);
    setError('');
    setNotice('');
    try {
      const res = await disableCustomerFriendLink();
      if (!res.ok) {
        if (AUTH_ERRORS.has(res.error)) {
          replace(LOGIN_NEXT_PATH);
          return;
        }
        setError(copy.actionFailure);
        return;
      }
      setFriendLink(null);
      setNotice(copy.linkDisabled);
    } catch {
      setError(copy.actionFailure);
    } finally {
      setActionPending(false);
    }
  }

  async function removeFriend(friendshipId: string) {
    setActionPending(true);
    setError('');
    setNotice('');
    try {
      const res = await removeCustomerFriend(friendshipId);
      if (!res.ok) {
        if (AUTH_ERRORS.has(res.error)) {
          replace(LOGIN_NEXT_PATH);
          return;
        }
        setError(copy.actionFailure);
        return;
      }
      await loadData();
    } catch {
      setError(copy.actionFailure);
    } finally {
      setActionPending(false);
    }
  }

  return (
    <section className="customer-view customer-view--wide customer-friends-page">
      <div className="customer-panel customer-panel--wide customer-friends-panel">
        <div className="customer-panel__head">
          <p className="customer-panel__eyebrow">{copy.eyebrow}</p>
          <h1 className="customer-panel__title">{copy.title}</h1>
          <p className="customer-panel__body">{copy.description}</p>
        </div>

        {loading ? <p className="customer-inline-note">{copy.loading}</p> : null}
        {error ? <p className="customer-inline-note customer-inline-note--error">{error}</p> : null}
        {notice ? <p className="customer-inline-note">{notice}</p> : null}

        <section className="customer-friends-section" aria-labelledby="friend-link-title">
          <div>
            <h2 id="friend-link-title">{copy.linkTitle}</h2>
            <p>{copy.linkDescription}</p>
          </div>
          <div className="customer-friend-link-box">
            <span>{friendLink?.url ?? ''}</span>
          </div>
          <div className="customer-action-row">
            <button
              type="button"
              className="customer-action customer-action--primary"
              onClick={copyLink}
              disabled={!friendLink || actionPending}
            >
              {copy.copyLink}
            </button>
            <button
              type="button"
              className="customer-action customer-action--secondary"
              onClick={resetLink}
              disabled={!friendLink || actionPending}
            >
              {copy.resetLink}
            </button>
            <button
              type="button"
              className="customer-action customer-action--secondary"
              onClick={disableLink}
              disabled={!friendLink || actionPending}
            >
              {copy.disableLink}
            </button>
          </div>
        </section>

        <div className="customer-friends-grid">
          <section className="customer-friends-section" aria-labelledby="incoming-requests-title">
            <h2 id="incoming-requests-title">{copy.incomingTitle}</h2>
            <RequestList
              copy={copy}
              emptyCopy={copy.emptyIncoming}
              requests={incomingRequests}
              kind="incoming"
              actionPending={actionPending}
              onAction={(action, requestId) => void runRequestAction(action, requestId)}
            />
          </section>

          <section className="customer-friends-section" aria-labelledby="outgoing-requests-title">
            <h2 id="outgoing-requests-title">{copy.outgoingTitle}</h2>
            <RequestList
              copy={copy}
              emptyCopy={copy.emptyOutgoing}
              requests={outgoingRequests}
              kind="outgoing"
              actionPending={actionPending}
              onAction={(action, requestId) => void runRequestAction(action, requestId)}
            />
          </section>
        </div>

        <section className="customer-friends-section" aria-labelledby="current-friends-title">
          <h2 id="current-friends-title">{copy.friendsTitle}</h2>
          {friends.length === 0 ? (
            <p className="customer-friends-empty">{copy.emptyFriends}</p>
          ) : (
            <div className="customer-friends-list">
              {friends.map((friend) => (
                <article className="customer-friend-row" key={friend.id}>
                  <div>
                    <strong>{friend.counterpartProfile?.displayName || copy.unknownFriend}</strong>
                    <span>{friend.counterpartAccountId}</span>
                  </div>
                  <div className="customer-friend-row__actions">
                    <button
                      type="button"
                      className="customer-action customer-action--secondary"
                      onClick={() => void removeFriend(friend.id)}
                      disabled={actionPending}
                    >
                      {copy.removeFriend}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
