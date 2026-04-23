import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import {
  buildGoogleCalendarAuthUrl,
} from '../lib/google-calendar-oauth.js';
import {
  createCalendarImportRun,
  getCalendarImportRunById,
  getLatestCalendarImportRun,
} from '../lib/google-calendar-import-runs.js';
import {
  preflightGoogleCalendarImport,
} from '../lib/google-calendar-runtime-client.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';

declare module 'hono' {
  interface ContextVariableMap {
    customerImportAuth: CustomerSession;
  }
}

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

function readDomainClient(): string {
  const value = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  if (!value) {
    throw new Error('DOMAIN_CLIENT is required');
  }
  return value;
}

export function readGoogleCalendarRedirectUri(): string {
  return `${readDomainClient()}/api/customer/google-calendar-import/callback/google`;
}

async function requireCustomerImportAuth(c: Context, next: Next): Promise<Response | void> {
  const token = readBearerToken(c);
  if (!token) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const payload = verifyCustomerToken(token);
    const session = await getCustomerSession(db as never, {
      customerId: payload.sub,
      identityId: payload.identityId,
    });

    if (!session) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    if (session.claimStatus !== 'active') {
      return c.json({ ok: false, error: 'claim_inactive' }, 403);
    }

    c.set('customerImportAuth', session);
    await next();
    return;
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }
}

async function resolveImportAccess(session: CustomerSession) {
  return resolveCokeAccountAccess({
    account: {
      id: session.customerId,
      status: 'normal',
      emailVerified: session.claimStatus === 'active',
    },
  });
}

function mapAccessDeniedReason(reason: string | null): Response | null {
  if (!reason) {
    return null;
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: reason,
    }),
    {
      status: 403,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
      },
    },
  );
}

function serializeRun(run: Awaited<ReturnType<typeof getLatestCalendarImportRun>>) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    status: run.status,
    providerAccountEmail: run.providerAccountEmail,
    importedCount: run.importedCount,
    skippedCount: run.skippedCount,
    failedCount: run.failedCount,
    errorSummary: run.errorSummary,
  };
}

export const customerGoogleCalendarImportRouter = new Hono()
  .use('/preflight', requireCustomerImportAuth)
  .use('/start', requireCustomerImportAuth)
  .use('/status', requireCustomerImportAuth)
  .get('/preflight', async (c) => {
    const auth = c.get('customerImportAuth');
    const [access, latestRun] = await Promise.all([
      resolveImportAccess(auth),
      getLatestCalendarImportRun(db as never, {
        customerId: auth.customerId,
        identityId: auth.identityId,
      }),
    ]);

    if (!access.accountAccessAllowed) {
      return c.json({
        ok: true,
        data: {
          ready: false,
          blockedReason: access.accountAccessDeniedReason,
          latestRun: serializeRun(latestRun),
        },
      });
    }

    const preflight = await preflightGoogleCalendarImport({
      customerId: auth.customerId,
      identityId: auth.identityId,
    });

    if (!preflight.ok) {
      return c.json({ ok: false, error: preflight.error }, 503);
    }

    if (!preflight.data.ready) {
      return c.json({
        ok: true,
        data: {
          ready: false,
          blockedReason: preflight.data.blockedReason,
          latestRun: serializeRun(latestRun),
        },
      });
    }

    return c.json({
      ok: true,
      data: {
        ready: true,
        latestRun: serializeRun(latestRun),
      },
    });
  })
  .post('/start', async (c) => {
    const auth = c.get('customerImportAuth');
    const access = await resolveImportAccess(auth);
    const denied = mapAccessDeniedReason(access.accountAccessDeniedReason);
    if (denied) {
      return denied;
    }

    const preflight = await preflightGoogleCalendarImport({
      customerId: auth.customerId,
      identityId: auth.identityId,
    });

    if (!preflight.ok) {
      return c.json({ ok: false, error: preflight.error }, 503);
    }

    if (!preflight.data.ready) {
      return c.json(
        {
          ok: false,
          error: preflight.data.blockedReason,
        },
        409,
      );
    }

    const run = await createCalendarImportRun(db as never, {
      customerId: auth.customerId,
      identityId: auth.identityId,
      targetConversationId: preflight.data.conversationId,
      targetCharacterId: preflight.data.characterId,
      triggerSource: 'manual_web',
    });
    const url = await buildGoogleCalendarAuthUrl({
      runId: run.id,
      customerId: auth.customerId,
      identityId: auth.identityId,
      targetTimezone: preflight.data.timezone,
      redirectUri: readGoogleCalendarRedirectUri(),
    });

    return c.json({
      ok: true,
      data: {
        runId: run.id,
        url,
      },
    });
  })
  .get('/status', async (c) => {
    const auth = c.get('customerImportAuth');
    const requestedRunId = c.req.query('runId')?.trim();
    const [latestRun, requestedRun] = await Promise.all([
      getLatestCalendarImportRun(db as never, {
        customerId: auth.customerId,
        identityId: auth.identityId,
      }),
      requestedRunId ? getCalendarImportRunById(db as never, requestedRunId) : Promise.resolve(null),
    ]);
    const ownedRequestedRun =
      requestedRun &&
      requestedRun.customerId === auth.customerId &&
      requestedRun.identityId === auth.identityId
        ? requestedRun
        : null;

    return c.json({
      ok: true,
      data: {
        latestRun: serializeRun(latestRun),
        ...(requestedRunId ? { run: serializeRun(ownedRequestedRun) } : {}),
      },
    });
  });
