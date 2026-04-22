import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const auth = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  getCustomerSession: vi.fn(),
}));

const access = vi.hoisted(() => ({
  resolveCokeAccountAccess: vi.fn(),
}));

const runtimeClient = vi.hoisted(() => ({
  preflightGoogleCalendarImport: vi.fn(),
  runGoogleCalendarImport: vi.fn(),
}));

const oauth = vi.hoisted(() => ({
  buildGoogleCalendarAuthUrl: vi.fn(),
  verifyGoogleCalendarState: vi.fn(),
  exchangeGoogleCalendarCode: vi.fn(),
  fetchGooglePrimaryCalendarEvents: vi.fn(),
}));

const importRuns = vi.hoisted(() => ({
  createCalendarImportRun: vi.fn(),
  getLatestCalendarImportRun: vi.fn(),
  getCalendarImportRunById: vi.fn(),
  markCalendarImportRunImporting: vi.fn(),
  markCalendarImportRunFinished: vi.fn(),
}));

vi.mock('../lib/customer-auth.js', () => auth);
vi.mock('../lib/coke-account-access.js', () => access);
vi.mock('../lib/google-calendar-runtime-client.js', () => runtimeClient);
vi.mock('../lib/google-calendar-oauth.js', () => oauth);
vi.mock('../lib/google-calendar-import-runs.js', () => importRuns);
vi.mock('../db/index.js', () => ({ db: {} }));

import { customerGoogleCalendarImportRouter } from './customer-google-calendar-import-routes.js';
import { customerGoogleCalendarImportCallbackRouter } from './customer-google-calendar-import-callback-routes.js';

describe('customer google calendar import routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_CLIENT = 'https://app.example';

    auth.verifyCustomerToken.mockReturnValue({
      sub: 'ck_123',
      identityId: 'idt_123',
    });
    auth.getCustomerSession.mockResolvedValue({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
    access.resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-01T00:00:00.000Z',
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://app.example/account/subscription',
    });
    importRuns.getLatestCalendarImportRun.mockResolvedValue(null);
    importRuns.getCalendarImportRunById.mockResolvedValue(null);
    oauth.buildGoogleCalendarAuthUrl.mockResolvedValue(
      'https://accounts.google.com/o/oauth2/v2/auth?state=test-state',
    );
    oauth.verifyGoogleCalendarState.mockReturnValue({
      runId: 'cir_1',
      customerId: 'ck_123',
      identityId: 'idt_123',
      codeVerifier: 'verifier-123',
    });
    oauth.exchangeGoogleCalendarCode.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: null,
      expiryDate: null,
      providerAccountEmail: 'alice@example.com',
    });
    oauth.fetchGooglePrimaryCalendarEvents.mockResolvedValue({
      providerAccountEmail: 'alice@example.com',
      events: [
        {
          id: 'evt_1',
          summary: 'Planning meeting',
          start: { dateTime: '2026-04-24T09:00:00.000Z' },
          end: { dateTime: '2026-04-24T10:00:00.000Z' },
        },
      ],
    });
    importRuns.markCalendarImportRunImporting.mockResolvedValue({
      id: 'cir_1',
      status: 'importing',
    });
    runtimeClient.runGoogleCalendarImport.mockResolvedValue({
      ok: true,
      data: {
        importedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        errorSummary: null,
      },
    });
    importRuns.markCalendarImportRunFinished.mockResolvedValue({
      id: 'cir_1',
      status: 'succeeded',
      importedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      errorSummary: null,
    });
  });

  it('blocks start when the customer email is not verified', async () => {
    access.resolveCokeAccountAccess.mockResolvedValueOnce({
      accountStatus: 'normal',
      emailVerified: false,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-01T00:00:00.000Z',
      accountAccessAllowed: false,
      accountAccessDeniedReason: 'email_not_verified',
      renewalUrl: 'https://app.example/account/subscription',
    });

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportRouter);

    const res = await app.request('/api/customer/google-calendar-import/start', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'email_not_verified',
    });
  });

  it('returns bridge preflight state and latest run summary', async () => {
    runtimeClient.preflightGoogleCalendarImport.mockResolvedValueOnce({
      ok: true,
      data: {
        ready: false,
        blockedReason: 'conversation_required',
      },
    });
    importRuns.getLatestCalendarImportRun.mockResolvedValueOnce({
      id: 'cir_prev',
      status: 'failed',
      importedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      errorSummary: 'conversation_required',
    });

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportRouter);

    const res = await app.request('/api/customer/google-calendar-import/preflight', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer customer-token',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        ready: false,
        blockedReason: 'conversation_required',
        latestRun: {
          id: 'cir_prev',
          status: 'failed',
          importedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          errorSummary: 'conversation_required',
        },
      },
    });
  });

  it('returns a Google auth URL after bridge preflight resolves a target conversation', async () => {
    runtimeClient.preflightGoogleCalendarImport.mockResolvedValueOnce({
      ok: true,
      data: {
        ready: true,
        conversationId: 'conv_1',
        userId: 'ck_123',
        characterId: 'char_1',
        timezone: 'Asia/Tokyo',
      },
    });
    importRuns.createCalendarImportRun.mockResolvedValueOnce({
      id: 'cir_1',
      status: 'authorizing',
    });

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportRouter);

    const res = await app.request('/api/customer/google-calendar-import/start', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        runId: 'cir_1',
        url: expect.stringContaining('accounts.google.com'),
      },
    });
    expect(runtimeClient.preflightGoogleCalendarImport).toHaveBeenCalledWith({
      customerId: 'ck_123',
      identityId: 'idt_123',
    });
    expect(importRuns.createCalendarImportRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerId: 'ck_123',
        identityId: 'idt_123',
        targetConversationId: 'conv_1',
        targetCharacterId: 'char_1',
        triggerSource: 'manual_web',
      }),
    );
    expect(oauth.buildGoogleCalendarAuthUrl).toHaveBeenCalledWith({
      runId: 'cir_1',
      customerId: 'ck_123',
      identityId: 'idt_123',
      redirectUri: 'https://app.example/api/customer/google-calendar-import/callback/google',
    });
  });

  it('returns the latest import run status for the active customer session', async () => {
    importRuns.getLatestCalendarImportRun.mockResolvedValueOnce({
      id: 'cir_1',
      status: 'succeeded_with_errors',
      providerAccountEmail: 'alice@example.com',
      importedCount: 3,
      skippedCount: 1,
      failedCount: 1,
      errorSummary: 'one event could not be imported',
    });

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportRouter);

    const res = await app.request('/api/customer/google-calendar-import/status', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer customer-token',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        latestRun: {
          id: 'cir_1',
          status: 'succeeded_with_errors',
          providerAccountEmail: 'alice@example.com',
          importedCount: 3,
          skippedCount: 1,
          failedCount: 1,
          errorSummary: 'one event could not be imported',
        },
      },
    });
  });

  it('completes the callback flow, advances the run state, and redirects back to web', async () => {
    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);

    const res = await app.request(
      '/api/customer/google-calendar-import/callback/google?state=signed-state&code=auth-code-123',
      {
        method: 'GET',
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example/account/calendar-import?googleCalendarImport=complete&runId=cir_1',
    );
    expect(oauth.verifyGoogleCalendarState).toHaveBeenCalledWith('signed-state');
    expect(oauth.exchangeGoogleCalendarCode).toHaveBeenCalledWith({
      code: 'auth-code-123',
      codeVerifier: 'verifier-123',
      redirectUri: 'https://app.example/api/customer/google-calendar-import/callback/google',
    });
    expect(importRuns.markCalendarImportRunImporting).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: 'cir_1',
        providerAccountEmail: undefined,
      },
    );
    expect(runtimeClient.runGoogleCalendarImport).toHaveBeenCalledWith({
      customerId: 'ck_123',
      identityId: 'idt_123',
      runId: 'cir_1',
      providerAccountEmail: 'alice@example.com',
      events: [
        expect.objectContaining({
          id: 'evt_1',
          summary: 'Planning meeting',
        }),
      ],
    });
    expect(importRuns.markCalendarImportRunFinished).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: 'cir_1',
        status: 'succeeded',
        providerAccountEmail: 'alice@example.com',
        importedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        errorSummary: null,
      },
    );
  });

  it('marks the run failed and redirects with an error when the callback import fails', async () => {
    runtimeClient.runGoogleCalendarImport.mockResolvedValueOnce({
      ok: false,
      error: 'runtime_unavailable',
    });

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);

    const res = await app.request(
      '/api/customer/google-calendar-import/callback/google?state=signed-state&code=auth-code-123',
      {
        method: 'GET',
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example/account/calendar-import?googleCalendarImport=error&runId=cir_1',
    );
    expect(importRuns.markCalendarImportRunFinished).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'cir_1',
        status: 'failed',
        importedCount: 0,
        skippedCount: 0,
        failedCount: 1,
        errorSummary: 'runtime_unavailable',
      }),
    );
  });

  it('marks the run failed when Google returns a provider error before code exchange', async () => {
    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);

    const res = await app.request(
      '/api/customer/google-calendar-import/callback/google?state=signed-state&error=access_denied',
      {
        method: 'GET',
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example/account/calendar-import?googleCalendarImport=error&runId=cir_1',
    );
    expect(importRuns.markCalendarImportRunImporting).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: 'cir_1',
        providerAccountEmail: undefined,
      },
    );
    expect(oauth.exchangeGoogleCalendarCode).not.toHaveBeenCalled();
    expect(importRuns.markCalendarImportRunFinished).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'cir_1',
        status: 'failed',
        errorSummary: 'access_denied',
      }),
    );
  });

  it('marks the run failed when the callback is missing the authorization code', async () => {
    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);

    const res = await app.request(
      '/api/customer/google-calendar-import/callback/google?state=signed-state',
      {
        method: 'GET',
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example/account/calendar-import?googleCalendarImport=error&runId=cir_1',
    );
    expect(importRuns.markCalendarImportRunImporting).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: 'cir_1',
        providerAccountEmail: undefined,
      },
    );
    expect(oauth.exchangeGoogleCalendarCode).not.toHaveBeenCalled();
    expect(importRuns.markCalendarImportRunFinished).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'cir_1',
        status: 'failed',
        errorSummary: 'missing_google_calendar_code',
      }),
    );
  });

  it('marks the run failed when token exchange fails before calendar fetch', async () => {
    oauth.exchangeGoogleCalendarCode.mockRejectedValueOnce(new Error('token_exchange_failed'));

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);

    const res = await app.request(
      '/api/customer/google-calendar-import/callback/google?state=signed-state&code=auth-code-123',
      {
        method: 'GET',
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example/account/calendar-import?googleCalendarImport=error&runId=cir_1',
    );
    expect(importRuns.markCalendarImportRunImporting).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: 'cir_1',
        providerAccountEmail: undefined,
      },
    );
    expect(oauth.fetchGooglePrimaryCalendarEvents).not.toHaveBeenCalled();
    expect(importRuns.markCalendarImportRunFinished).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'cir_1',
        status: 'failed',
        errorSummary: 'token_exchange_failed',
      }),
    );
  });

  it('redirects to the existing summary when the callback is revisited after a terminal successful run', async () => {
    importRuns.getCalendarImportRunById.mockResolvedValueOnce({
      id: 'cir_1',
      status: 'succeeded',
      providerAccountEmail: 'alice@example.com',
      importedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      errorSummary: null,
    });

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);

    const res = await app.request(
      '/api/customer/google-calendar-import/callback/google?state=signed-state&code=auth-code-123',
      {
        method: 'GET',
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example/account/calendar-import?googleCalendarImport=complete&runId=cir_1',
    );
    expect(importRuns.markCalendarImportRunImporting).not.toHaveBeenCalled();
    expect(oauth.exchangeGoogleCalendarCode).not.toHaveBeenCalled();
    expect(oauth.fetchGooglePrimaryCalendarEvents).not.toHaveBeenCalled();
    expect(runtimeClient.runGoogleCalendarImport).not.toHaveBeenCalled();
  });

  it('redirects to the existing summary when the callback is revisited while the run is already importing', async () => {
    importRuns.getCalendarImportRunById.mockResolvedValueOnce({
      id: 'cir_1',
      status: 'importing',
      providerAccountEmail: 'alice@example.com',
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errorSummary: null,
    });

    const app = new Hono();
    app.route('/api/customer/google-calendar-import', customerGoogleCalendarImportCallbackRouter);

    const res = await app.request(
      '/api/customer/google-calendar-import/callback/google?state=signed-state&code=auth-code-123',
      {
        method: 'GET',
      },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://app.example/account/calendar-import?googleCalendarImport=complete&runId=cir_1',
    );
    expect(importRuns.markCalendarImportRunImporting).not.toHaveBeenCalled();
    expect(oauth.exchangeGoogleCalendarCode).not.toHaveBeenCalled();
    expect(oauth.fetchGooglePrimaryCalendarEvents).not.toHaveBeenCalled();
    expect(runtimeClient.runGoogleCalendarImport).not.toHaveBeenCalled();
  });
});
