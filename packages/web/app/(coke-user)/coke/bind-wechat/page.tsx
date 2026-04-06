'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import type { ApiResponse } from '@clawscale/shared';
import { cokeUserApi } from '@/lib/coke-user-api';
import {
  getCokeBindFailureKind,
  shouldFailCokeBindStatusPoll,
  shouldStartCokeBindSession,
} from '@/lib/coke-user-bind';
import {
  clearCokeUserAuth,
  getCokeUser,
  getCokeUserToken,
} from '@/lib/coke-user-auth';

type BindState =
  | { status: 'unbound' }
  | { status: 'pending'; connect_url: string; expires_at: number }
  | { status: 'bound'; masked_identity: string }
  | { status: 'expired' }
  | { status: 'failed' };

export default function BindWechatPage() {
  const router = useRouter();
  const [bindState, setBindState] = useState<BindState>({ status: 'unbound' });
  const [failureKind, setFailureKind] = useState<'auth' | 'generic'>('generic');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [userName, setUserName] = useState('');
  const pollFailureCountRef = useRef(0);

  useEffect(() => {
    const token = getCokeUserToken();

    setIsDesktop(window.innerWidth >= 1024);
    setHasToken(token != null);
    setUserName(getCokeUser()?.display_name ?? '');
  }, []);

  useEffect(() => {
    if (hasToken === false) {
      router.replace('/coke/login');
    }
  }, [hasToken, router]);

  useEffect(() => {
    if (!shouldStartCokeBindSession({ isDesktop, hasToken })) {
      return;
    }

    pollFailureCountRef.current = 0;

    void cokeUserApi
      .post<ApiResponse<BindState>>('/user/wechat-bind/session')
      .then((res) => {
        if (!res.ok) {
          setFailureKind(getCokeBindFailureKind(res));
          setBindState({ status: 'failed' });
          return;
        }
        setBindState(res.data);
      })
      .catch(() => {
        setFailureKind('generic');
        setBindState({ status: 'failed' });
      });
  }, [hasToken, isDesktop, sessionAttempt]);

  useEffect(() => {
    if (bindState.status !== 'pending') {
      setQrDataUrl(null);
      return;
    }

    void QRCode.toDataURL(bindState.connect_url).then(setQrDataUrl);

    const timer = window.setInterval(() => {
      void cokeUserApi
        .get<ApiResponse<BindState>>('/user/wechat-bind/status')
        .then((res) => {
          if (!res.ok) {
            const nextFailureCount = pollFailureCountRef.current + 1;
            pollFailureCountRef.current = nextFailureCount;

            if (shouldFailCokeBindStatusPoll({
              ...res,
              consecutiveGenericFailures: nextFailureCount,
            })) {
              setFailureKind(getCokeBindFailureKind(res));
              setBindState({ status: 'failed' });
            }
            return;
          }

          pollFailureCountRef.current = 0;
          setBindState(res.data);
        })
        .catch(() => {
          const nextFailureCount = pollFailureCountRef.current + 1;
          pollFailureCountRef.current = nextFailureCount;

          if (shouldFailCokeBindStatusPoll({ consecutiveGenericFailures: nextFailureCount })) {
            setFailureKind('generic');
            setBindState({ status: 'failed' });
          }
        });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [bindState]);

  function handleSignOut() {
    clearCokeUserAuth();
    router.replace('/coke/login');
  }

  function handleRetry() {
    pollFailureCountRef.current = 0;
    setFailureKind('generic');
    setBindState({ status: 'unbound' });
    setSessionAttempt((value) => value + 1);
  }

  if (bindState.status === 'bound') {
    return (
      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-700">Connected</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950">WeChat is bound</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700">
            {userName ? `${userName}, ` : ''}
            your Coke account is now linked to WeChat <span className="font-medium">{bindState.masked_identity}</span>.
            Future conversations happen in WeChat after you send Coke any message there.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8">
          <h2 className="text-lg font-semibold text-slate-950">What happens next</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Keep chatting in WeChat. You can come back here later to confirm the binding status.
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-6 rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  if (bindState.status === 'expired') {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-3xl font-semibold text-slate-950">QR code expired</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">
          The current binding session timed out before it was completed.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Generate a new QR code
        </button>
      </section>
    );
  }

  if (bindState.status === 'failed') {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-8">
        <h1 className="text-3xl font-semibold text-slate-950">Unable to start WeChat binding</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">
          {failureKind === 'auth'
            ? 'Your Coke website sign-in is no longer valid. Sign in again to create a fresh WeChat bind session.'
            : 'Coke could not create or refresh the current WeChat bind session. You can retry with a new session now.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {failureKind === 'auth' ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Sign in again
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Generate a new QR code
            </button>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            Sign in again
          </button>
        </div>
      </section>
    );
  }

  if (hasToken === false) {
    return null;
  }

  if (hasToken === null || isDesktop === null) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-slate-50 p-8">
        <h1 className="text-3xl font-semibold text-slate-950">Preparing WeChat binding</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">
          Coke only starts a WeChat bind session after desktop access and sign-in are confirmed.
        </p>
      </section>
    );
  }

  if (!isDesktop) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-slate-50 p-8">
        <h1 className="text-3xl font-semibold text-slate-950">Desktop required</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">
          Please open this page on a desktop browser for the v1 WeChat bind flow.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Sign in on the website from your computer, scan the QR code with your phone, then continue the long-term chat in WeChat.
        </p>
      </section>
    );
  }

  const expiresAt =
    bindState.status === 'pending'
      ? new Date(bindState.expires_at).toLocaleString()
      : null;

  return (
    <section className="grid gap-6 lg:grid-cols-[1.35fr_0.95fr]">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Step 2 of 2</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Bind your WeChat</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700">
          Sign in to Coke on the web first. Then use WeChat on your phone to scan this code and send any message to Coke.
          After that, your ongoing conversations happen in WeChat.
        </p>

        <div className="mt-8 flex min-h-80 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-6">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Bind Coke WeChat"
              className="h-72 w-72 rounded-2xl border border-slate-200"
            />
          ) : (
            <p className="text-sm text-slate-500">Preparing your QR code...</p>
          )}
        </div>

        {expiresAt ? (
          <p className="mt-4 text-xs text-slate-500">This code expires at {expiresAt}.</p>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-8">
        <h2 className="text-lg font-semibold text-slate-950">Before you scan</h2>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
          <li>Use your desktop browser for this page.</li>
          <li>Scan with the WeChat account you want permanently linked.</li>
          <li>Once connected, return to WeChat for future conversations.</li>
        </ul>

        <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          Need an account instead?{' '}
          <Link href="/coke/register" className="font-medium text-slate-950 underline underline-offset-4">
            Create one here
          </Link>
          .
        </div>
      </div>
    </section>
  );
}
