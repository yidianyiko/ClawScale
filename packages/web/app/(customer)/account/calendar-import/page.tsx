'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  getCustomerGoogleCalendarImportPreflight,
  getCustomerGoogleCalendarImportStatus,
  startCustomerGoogleCalendarImport,
  type CustomerGoogleCalendarImportPreflightResult,
  type CustomerGoogleCalendarImportRunSummary,
} from '../../../../lib/customer-google-calendar-import';

function formatRunSummary(run: CustomerGoogleCalendarImportRunSummary): string {
  return `Imported ${run.importedCount}, skipped ${run.skippedCount}, failed ${run.failedCount}`;
}

function getRunTitle(run: CustomerGoogleCalendarImportRunSummary): string {
  if (run.status === 'authorizing' || run.status === 'importing') {
    return 'Importing your Google Calendar';
  }

  if (run.status === 'succeeded_with_errors') {
    return 'Completed with warnings';
  }

  if (run.status === 'failed') {
    return 'Import failed';
  }

  return 'Import complete';
}

function getRunDescription(run: CustomerGoogleCalendarImportRunSummary): string {
  if (run.status === 'authorizing' || run.status === 'importing') {
    return 'We are waiting for the Google callback to finish.';
  }

  if (run.status === 'succeeded_with_errors') {
    return run.errorSummary
      ? `Some events completed with warnings. Latest warning: ${run.errorSummary}.`
      : 'Some events completed with warnings.';
  }

  if (run.status === 'failed') {
    return run.errorSummary
      ? `The latest import failed. ${run.errorSummary}.`
      : 'The latest import failed.';
  }

  return 'Your latest calendar import finished successfully.';
}

function getPreflightDescription(preflight: CustomerGoogleCalendarImportPreflightResult): string {
  if (!preflight.ready) {
    return getBlockedState(preflight.blockedReason)?.description ?? 'Resolve account access before starting the import.';
  }

  return 'Connect Google Calendar to the active Coke conversation for this customer account.';
}

function getBlockedState(blockedReason: string | null | undefined): {
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
} | null {
  switch (blockedReason) {
    case 'conversation_required':
      return {
        title: 'Conversation required',
        description: 'Start or resume a Coke conversation first, then return here to launch the Google Calendar import.',
        ctaHref: '/channels/wechat-personal',
        ctaLabel: 'Open customer channels',
      };
    case 'subscription_required':
      return {
        title: 'Subscription required',
        description: 'Renew your subscription before importing Google Calendar.',
        ctaHref: '/account/subscription',
        ctaLabel: 'Manage subscription',
      };
    case 'email_not_verified':
      return {
        title: 'Email verification required',
        description: 'Verify your email before importing Google Calendar.',
        ctaHref: '/account/subscription',
        ctaLabel: 'Review account access',
      };
    case 'account_suspended':
      return {
        title: 'Account access is suspended',
        description: 'This customer account is suspended. Review your account status before importing Google Calendar.',
        ctaHref: '/account/subscription',
        ctaLabel: 'Review account status',
      };
    default:
      return null;
  }
}

function CustomerCalendarImportPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackState = searchParams.get('googleCalendarImport');
  const callbackRunId = searchParams.get('runId');
  const [preflight, setPreflight] = useState<CustomerGoogleCalendarImportPreflightResult | null>(null);
  const [latestRun, setLatestRun] = useState<CustomerGoogleCalendarImportRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [summaryNotice, setSummaryNotice] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadImportState() {
      setLoading(true);
      setError('');
      setSummaryNotice('');

      try {
        const preflightRes = await getCustomerGoogleCalendarImportPreflight();

        if (cancelled) {
          return;
        }

        if (!preflightRes.ok) {
          router.replace('/auth/login?next=/account/calendar-import');
          return;
        }

        setPreflight(preflightRes.data);
        setLatestRun(preflightRes.data.latestRun);

        if (callbackState) {
          const statusRes = await getCustomerGoogleCalendarImportStatus();
          if (!cancelled && statusRes.ok) {
            const matchingRun =
              !callbackRunId || statusRes.data.latestRun?.id === callbackRunId
                ? statusRes.data.latestRun
                : preflightRes.data.latestRun?.id === callbackRunId
                  ? preflightRes.data.latestRun
                  : null;

            setLatestRun(matchingRun);
            setSummaryNotice(
              callbackRunId && !matchingRun
                ? 'Waiting for the matching import summary for this authorization result.'
                : '',
            );
          }
        }
      } catch {
        if (!cancelled) {
          setError('Unable to load your Google Calendar import status right now.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadImportState();

    return () => {
      cancelled = true;
    };
  }, [callbackRunId, callbackState, router]);

  const readyToStart = preflight?.ready === true;
  const blockedState = preflight?.ready === false ? getBlockedState(preflight.blockedReason) : null;
  const importing = latestRun?.status === 'authorizing' || latestRun?.status === 'importing';
  const showStartButton = readyToStart && !loading && !importing && !summaryNotice;
  const run = latestRun;

  async function handleStartImport() {
    setStarting(true);
    setError('');

    try {
      const res = await startCustomerGoogleCalendarImport();
      if (!res.ok) {
        setError('Unable to start the Google Calendar import right now.');
        return;
      }

      window.open(res.data.url, '_self');
    } catch {
      setError('Unable to start the Google Calendar import right now.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-500">Google Calendar import</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Import your Google Calendar</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          {preflight ? getPreflightDescription(preflight) : 'Checking import readiness for this customer account.'}
        </p>
      </div>

      {callbackState ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          {callbackState === 'error'
            ? 'The Google authorization callback reported an error. The latest import summary is shown below.'
            : 'Google authorization finished. Refreshing the latest import summary.'}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm leading-6 text-slate-600">Loading your Google Calendar import status...</p>
      ) : error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && blockedState ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-amber-950">{blockedState.title}</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">{blockedState.description}</p>
          <Link
            href={blockedState.ctaHref}
            className="mt-4 inline-flex rounded-full border border-amber-300 px-4 py-2 text-sm font-medium text-amber-950 transition hover:border-amber-500"
          >
            {blockedState.ctaLabel}
          </Link>
        </div>
      ) : null}

      {!loading && !error && summaryNotice ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          {summaryNotice}
        </div>
      ) : null}

      {!loading && !error && run ? (
        <div
          className={`rounded-2xl border px-5 py-4 ${
            importing
              ? 'border-sky-200 bg-sky-50'
              : run.status === 'succeeded_with_errors'
                ? 'border-amber-200 bg-amber-50'
                : run.status === 'failed'
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-emerald-200 bg-emerald-50'
          }`}
        >
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">{getRunTitle(run)}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{getRunDescription(run)}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{formatRunSummary(run)}</p>
          {run.providerAccountEmail ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">Connected account: {run.providerAccountEmail}</p>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && !blockedState && !run ? (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-6 text-slate-600">
          No calendar import has run yet.
        </p>
      ) : null}

      {showStartButton ? (
        <button
          type="button"
          onClick={handleStartImport}
          disabled={starting}
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {starting ? 'Starting Google Calendar import...' : 'Start Google Calendar import'}
        </button>
      ) : null}
    </section>
  );
}

export default function CustomerCalendarImportPage() {
  return (
    <Suspense fallback={null}>
      <CustomerCalendarImportPageContent />
    </Suspense>
  );
}
