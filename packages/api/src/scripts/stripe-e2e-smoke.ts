import 'dotenv/config';

import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { chromium } from 'playwright';

type ApiEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

type RegisterResponse = ApiEnvelope<{
  customerId: string;
  identityId: string;
  claimStatus: string;
  email: string;
  membershipRole: string;
  token: string;
}>;

type CustomerLoginResponse = ApiEnvelope<{
  customerId: string;
  identityId: string;
  claimStatus: string;
  email: string;
  membershipRole: string;
  token: string;
}>;

type CheckoutResponse = ApiEnvelope<{
  url: string;
}>;

export type SubscriptionSnapshot = {
  accountStatus: string;
  emailVerified: boolean;
  subscriptionActive: boolean;
  subscriptionExpiresAt: string | null;
  accountAccessAllowed: boolean;
  accountAccessDeniedReason: string | null;
  renewalUrl: string;
};

type SubscriptionResponse = ApiEnvelope<SubscriptionSnapshot>;

type StripeSmokeConfig = {
  baseUrl: string;
  email: string;
  password: string;
  displayName: string;
  headless: boolean;
  timeoutMs: number;
  pollAttempts: number;
  pollIntervalMs: number;
  artifactsDir: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvc: string;
  cardholderName: string;
  billingCountry: string;
  billingPostalCode: string;
  requestRetries: number;
};

export type StripeSmokeResult = {
  baseUrl: string;
  email: string;
  customerId: string;
  identityId: string;
  claimStatus: string;
  checkoutSessionId: string;
  artifactsDir: string;
  paymentSuccessUrl: string;
  subscriptionExpiresAt: string;
  prePayment: SubscriptionSnapshot;
  postPayment: SubscriptionSnapshot;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parseIntegerEnv(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function buildDefaultEmail(): string {
  return `codex.stripe.smoke.${Date.now()}.${randomUUID().slice(0, 8)}@example.com`;
}

function buildDefaultPassword(): string {
  return `Smoke!${Date.now()}Aa`;
}

export function isRetriableRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = error.cause;
  if (!cause || typeof cause !== 'object' || !('code' in cause)) {
    return false;
  }

  return ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(
    String((cause as { code?: unknown }).code),
  );
}

function readConfig(env: NodeJS.ProcessEnv = process.env): StripeSmokeConfig {
  const baseUrl = normalizeBaseUrl(
    env['COKE_SMOKE_BASE_URL'] || env['DOMAIN_CLIENT'] || 'https://coke.keep4oforever.com',
  );

  return {
    baseUrl,
    email: env['COKE_SMOKE_EMAIL']?.trim() || buildDefaultEmail(),
    password: env['COKE_SMOKE_PASSWORD']?.trim() || buildDefaultPassword(),
    displayName: env['COKE_SMOKE_DISPLAY_NAME']?.trim() || 'Codex Stripe Smoke',
    headless: parseBooleanEnv(env['COKE_SMOKE_HEADLESS'], true),
    timeoutMs: parseIntegerEnv(env['COKE_SMOKE_TIMEOUT_MS'], 60_000, 'COKE_SMOKE_TIMEOUT_MS'),
    pollAttempts: parseIntegerEnv(env['COKE_SMOKE_POLL_ATTEMPTS'], 15, 'COKE_SMOKE_POLL_ATTEMPTS'),
    pollIntervalMs: parseIntegerEnv(
      env['COKE_SMOKE_POLL_INTERVAL_MS'],
      2_000,
      'COKE_SMOKE_POLL_INTERVAL_MS',
    ),
    artifactsDir:
      env['COKE_SMOKE_ARTIFACTS_DIR']?.trim() ||
      join(tmpdir(), 'coke-stripe-smoke', new Date().toISOString().replaceAll(':', '-')),
    cardNumber: env['COKE_SMOKE_CARD_NUMBER']?.trim() || '4242424242424242',
    cardExpiry: env['COKE_SMOKE_CARD_EXPIRY']?.trim() || '1234',
    cardCvc: env['COKE_SMOKE_CARD_CVC']?.trim() || '123',
    cardholderName: env['COKE_SMOKE_CARDHOLDER_NAME']?.trim() || 'Codex Stripe Smoke',
    billingCountry: env['COKE_SMOKE_BILLING_COUNTRY']?.trim() || 'US',
    billingPostalCode: env['COKE_SMOKE_BILLING_POSTAL_CODE']?.trim() || '10001',
    requestRetries: parseIntegerEnv(
      env['COKE_SMOKE_REQUEST_RETRIES'],
      3,
      'COKE_SMOKE_REQUEST_RETRIES',
    ),
  };
}

async function requestJson<T>(
  config: Pick<StripeSmokeConfig, 'requestRetries'>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  for (let attempt = 1; attempt <= config.requestRetries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      let payload: unknown = null;

      if (text.trim()) {
        try {
          payload = JSON.parse(text) as T;
        } catch (error) {
          throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`, {
            cause: error,
          });
        }
      }

      if (!response.ok) {
        const errorMessage =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error?: unknown }).error ?? 'request_failed')
            : text.slice(0, 200);
        throw new Error(`Request failed (${response.status}) for ${url}: ${errorMessage}`);
      }

      return payload as T;
    } catch (error) {
      if (attempt >= config.requestRetries || !isRetriableRequestError(error)) {
        throw error;
      }

      await sleep(1_000);
    }
  }

  throw new Error(`Exhausted retries for ${url}`);
}

function authHeaders(token?: string): Record<string, string> {
  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};
}

export function extractCheckoutSessionId(url: string): string {
  const match = url.match(/\/pay\/(cs_[^#?/]+)/);
  if (!match) {
    throw new Error(`Unable to extract checkout session from checkout session url: ${url}`);
  }

  const sessionId = match[1];
  if (!sessionId) {
    throw new Error(`Unable to extract checkout session from checkout session url: ${url}`);
  }

  return sessionId;
}

export function assertPrePaymentSubscription(data: SubscriptionSnapshot): void {
  const errors: string[] = [];

  if (!data.emailVerified) {
    errors.push('email is not verified');
  }
  if (!data.subscriptionActive) {
    errors.push('subscription is not active during trial');
  }
  if (!data.subscriptionExpiresAt) {
    errors.push('trial expiry is missing');
  }
  if (!data.accountAccessAllowed) {
    errors.push('account access is not allowed during trial');
  }
  if (data.accountAccessDeniedReason !== null) {
    errors.push('denied reason should be null during trial');
  }

  if (errors.length > 0) {
    throw new Error(`Unexpected subscription state before payment: ${errors.join('; ')}`);
  }
}

export function assertPostPaymentSubscription(data: SubscriptionSnapshot): void {
  const errors: string[] = [];

  if (!data.emailVerified) {
    errors.push('email is not verified');
  }
  if (!data.subscriptionActive) {
    errors.push('subscription is not active');
  }
  if (!data.subscriptionExpiresAt) {
    errors.push('subscription expiry is missing');
  }
  if (!data.accountAccessAllowed) {
    errors.push('account access is not allowed');
  }
  if (data.accountAccessDeniedReason !== null) {
    errors.push('denied reason should be null');
  }

  if (errors.length > 0) {
    throw new Error(`Unexpected subscription state after payment: ${errors.join('; ')}`);
  }
}

function paymentResultUrl(baseUrl: string, status: 'success' | 'cancel'): string {
  return `${baseUrl}/account/subscription?status=${status}`;
}

async function register(config: StripeSmokeConfig): Promise<RegisterResponse['data']> {
  const result = await requestJson<RegisterResponse>(
    config,
    `${config.baseUrl}/api/auth/register`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: config.email,
        password: config.password,
        displayName: config.displayName,
      }),
    },
  );

  if (!result.ok) {
    throw new Error(`Registration failed: ${result.error ?? 'unknown_error'}`);
  }

  return result.data;
}

export async function login(config: StripeSmokeConfig): Promise<CustomerLoginResponse['data']> {
  const result = await requestJson<CustomerLoginResponse>(
    config,
    `${config.baseUrl}/api/auth/login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: config.email,
        password: config.password,
      }),
    },
  );

  if (!result.ok) {
    throw new Error(`Customer login failed: ${result.error ?? 'unknown_error'}`);
  }

  return result.data;
}

async function fetchSubscription(
  config: StripeSmokeConfig,
  token: string,
): Promise<SubscriptionSnapshot> {
  const result = await requestJson<SubscriptionResponse>(
    config,
    `${config.baseUrl}/api/customer/subscription`,
    {
      headers: authHeaders(token),
    },
  );

  if (!result.ok) {
    throw new Error(`Subscription query failed: ${result.error ?? 'unknown_error'}`);
  }

  return result.data;
}

async function createCheckout(config: StripeSmokeConfig, token: string): Promise<string> {
  const result = await requestJson<CheckoutResponse>(
    config,
    `${config.baseUrl}/api/customer/subscription/checkout`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(token),
      },
    },
  );

  if (!result.ok || !result.data.url) {
    throw new Error(`Checkout creation failed: ${result.error ?? 'unknown_error'}`);
  }

  return result.data.url;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function completeHostedCheckout(
  config: StripeSmokeConfig,
  checkoutUrl: string,
): Promise<string> {
  await mkdir(config.artifactsDir, { recursive: true });

  const browser = await chromium.launch({
    headless: config.headless,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1200 },
    });

    await page.goto(checkoutUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeoutMs,
    });

    await page.waitForSelector('input[name="email"]', {
      timeout: config.timeoutMs,
    });

    await page.fill('input[name="email"]', config.email);
    await page.fill('input[name="cardNumber"]', config.cardNumber);
    await page.fill('input[name="cardExpiry"]', config.cardExpiry);
    await page.fill('input[name="cardCvc"]', config.cardCvc);
    await page.fill('input[name="billingName"]', config.cardholderName);

    const countrySelect = page.locator('select[name="billingCountry"]');
    if ((await countrySelect.count()) > 0) {
      await countrySelect.selectOption(config.billingCountry);
    }

    const postalInput = page.locator('input[name="billingPostalCode"]');
    if ((await postalInput.count()) > 0) {
      await postalInput.fill(config.billingPostalCode);
    }

    await page.screenshot({
      path: join(config.artifactsDir, 'checkout-filled.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: /^Pay/ }).click({
      timeout: config.timeoutMs,
    });

    await page.waitForURL(
      new RegExp(
        `^${escapeRegex(config.baseUrl)}/account/subscription\\?status=(success|cancel)(?:&.*)?$`,
      ),
      {
        timeout: config.timeoutMs,
      },
    );

    await page.screenshot({
      path: join(config.artifactsDir, 'checkout-result.png'),
      fullPage: true,
    });

    const finalUrl = page.url();
    if (finalUrl !== paymentResultUrl(config.baseUrl, 'success')) {
      throw new Error(`Checkout did not land on the success page: ${finalUrl}`);
    }

    return finalUrl;
  } finally {
    await browser.close();
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForActiveSubscription(
  config: StripeSmokeConfig,
  token: string,
): Promise<SubscriptionSnapshot> {
  let lastSnapshot: SubscriptionSnapshot | null = null;

  // Stripe webhooks are asynchronous, so poll until the access window is written.
  for (let attempt = 0; attempt < config.pollAttempts; attempt += 1) {
    lastSnapshot = await fetchSubscription(config, token);
    if (lastSnapshot.subscriptionActive) {
      assertPostPaymentSubscription(lastSnapshot);
      return lastSnapshot;
    }

    await sleep(config.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for an active subscription after payment: ${JSON.stringify(lastSnapshot)}`,
  );
}

export async function runStripeSmoke(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StripeSmokeResult> {
  setDefaultResultOrder('ipv4first');

  const config = readConfig(env);
  const registration = await register(config);
  const loginResult = await login(config);
  const prePayment = await fetchSubscription(config, loginResult.token);

  assertPrePaymentSubscription(prePayment);

  const checkoutUrl = await createCheckout(config, loginResult.token);
  const checkoutSessionId = extractCheckoutSessionId(checkoutUrl);
  const paymentSuccessUrl = await completeHostedCheckout(config, checkoutUrl);
  const postPayment = await waitForActiveSubscription(config, loginResult.token);
  const prePaymentExpiresAt = new Date(prePayment.subscriptionExpiresAt ?? 0);
  const postPaymentExpiresAt = new Date(postPayment.subscriptionExpiresAt ?? 0);

  if (!(postPaymentExpiresAt > prePaymentExpiresAt)) {
    throw new Error(
      `Paid access did not extend beyond trial access: pre=${prePayment.subscriptionExpiresAt}, post=${postPayment.subscriptionExpiresAt}`,
    );
  }

  return {
    baseUrl: config.baseUrl,
    email: config.email,
    customerId: registration.customerId,
    identityId: registration.identityId,
    claimStatus: registration.claimStatus,
    checkoutSessionId,
    artifactsDir: config.artifactsDir,
    paymentSuccessUrl,
    subscriptionExpiresAt: postPayment.subscriptionExpiresAt ?? '',
    prePayment,
    postPayment,
  };
}

export async function main(): Promise<void> {
  const result = await runStripeSmoke();
  console.log(JSON.stringify(result, null, 2));
}

const executedAsScript =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedAsScript) {
  main().catch((error) => {
    console.error('[stripe-e2e-smoke] failed', error);
    process.exitCode = 1;
  });
}
