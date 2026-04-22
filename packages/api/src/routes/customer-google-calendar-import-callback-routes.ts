import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  exchangeGoogleCalendarCode,
  fetchGooglePrimaryCalendarEvents,
  verifyGoogleCalendarState,
} from '../lib/google-calendar-oauth.js';
import {
  getCalendarImportRunById,
  markCalendarImportRunFinished,
  markCalendarImportRunImporting,
} from '../lib/google-calendar-import-runs.js';
import { runGoogleCalendarImport } from '../lib/google-calendar-runtime-client.js';
import { readGoogleCalendarRedirectUri } from './customer-google-calendar-import-routes.js';

function readDomainClient(): string {
  const value = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  if (!value) {
    throw new Error('DOMAIN_CLIENT is required');
  }
  return value;
}

function buildSummaryRedirect(input: { runId?: string; status: 'complete' | 'error' }): string {
  const url = new URL('/account/calendar-import', readDomainClient());
  url.searchParams.set('googleCalendarImport', input.status);
  if (input.runId) {
    url.searchParams.set('runId', input.runId);
  }
  return url.toString();
}

function resolveFinishedStatus(input: { failedCount: number; errorSummary: string | null }): 'succeeded' | 'succeeded_with_errors' {
  if (input.failedCount > 0 || input.errorSummary) {
    return 'succeeded_with_errors';
  }

  return 'succeeded';
}

function isTerminalRunStatus(status: string): status is 'succeeded' | 'succeeded_with_errors' | 'failed' {
  return status === 'succeeded' || status === 'succeeded_with_errors' || status === 'failed';
}

function isCompletedOrInFlightRunStatus(
  status: string,
): status is 'importing' | 'succeeded' | 'succeeded_with_errors' | 'failed' {
  return status === 'importing' || isTerminalRunStatus(status);
}

function resolveSummaryRedirectStatus(status: 'succeeded' | 'succeeded_with_errors' | 'failed'): 'complete' | 'error' {
  return status === 'failed' ? 'error' : 'complete';
}

export const customerGoogleCalendarImportCallbackRouter = new Hono().get(
  '/callback/google',
  async (c) => {
    const state = c.req.query('state')?.trim();
    const code = c.req.query('code')?.trim();
    const providerError = c.req.query('error')?.trim();

    let runId: string | undefined;

    try {
      if (!state) {
        throw new Error('missing_google_calendar_state');
      }

      const verified = verifyGoogleCalendarState(state);
      runId = verified.runId;

      const existingRun = await getCalendarImportRunById(db as never, verified.runId);
      if (existingRun && isCompletedOrInFlightRunStatus(existingRun.status)) {
        return c.redirect(
          buildSummaryRedirect({
            runId: existingRun.id,
            status:
              existingRun.status === 'importing'
                ? 'complete'
                : resolveSummaryRedirectStatus(existingRun.status),
          }),
          302,
        );
      }

      await markCalendarImportRunImporting(db as never, {
        id: verified.runId,
      });

      if (providerError) {
        throw new Error(providerError);
      }

      if (!code) {
        throw new Error('missing_google_calendar_code');
      }

      const tokens = await exchangeGoogleCalendarCode({
        code,
        codeVerifier: verified.codeVerifier,
        redirectUri: readGoogleCalendarRedirectUri(),
      });
      const calendar = await fetchGooglePrimaryCalendarEvents(tokens.accessToken);
      const providerAccountEmail = calendar.providerAccountEmail ?? tokens.providerAccountEmail;

      const result = await runGoogleCalendarImport({
        customerId: verified.customerId,
        identityId: verified.identityId,
        runId: verified.runId,
        providerAccountEmail,
        events: calendar.events,
      });

      if (!result.ok) {
        await markCalendarImportRunFinished(db as never, {
          id: verified.runId,
          status: 'failed',
          providerAccountEmail,
          importedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          errorSummary: result.error,
        });
        return c.redirect(
          buildSummaryRedirect({
            runId: verified.runId,
            status: 'error',
          }),
          302,
        );
      }

      await markCalendarImportRunFinished(db as never, {
        id: verified.runId,
        status: resolveFinishedStatus(result.data),
        providerAccountEmail,
        importedCount: result.data.importedCount,
        skippedCount: result.data.skippedCount,
        failedCount: result.data.failedCount,
        errorSummary: result.data.errorSummary,
      });

      return c.redirect(
        buildSummaryRedirect({
          runId: verified.runId,
          status: 'complete',
        }),
        302,
      );
    } catch (error) {
      if (runId) {
        await markCalendarImportRunFinished(db as never, {
          id: runId,
          status: 'failed',
          importedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          errorSummary: error instanceof Error ? error.message : 'google_calendar_callback_failed',
        }).catch(() => undefined);
      }

      return c.redirect(
        buildSummaryRedirect({
          runId,
          status: 'error',
        }),
        302,
      );
    }
  },
);
