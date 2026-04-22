import Stripe from 'stripe';
import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { verifyPublicCheckoutToken } from '../lib/coke-public-checkout.js';
import {
  calculateStackedAccessWindow,
  calculateTrialExpiresAt,
} from '../lib/coke-subscription.js';
import { getCustomerSession, verifyCustomerToken, type CustomerSession } from '../lib/customer-auth.js';

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '');

type CustomerSubscriptionAuth = CustomerSession;

declare module 'hono' {
  interface ContextVariableMap {
    customerSubscriptionAuth: CustomerSubscriptionAuth;
  }
}

function isPrismaUniqueConstraintError(error: unknown): error is { code: string } {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
}

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function requireCustomerSubscriptionAuth(
  c: Context,
  next: Next,
): Promise<Response | void> {
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

    c.set('customerSubscriptionAuth', session);
    await next();
    return;
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }
}

function readDomainClient(): string {
  return process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '') ?? '';
}

function readPriceId(): string {
  return process.env['STRIPE_PRICE_ID']?.trim() ?? '';
}

function readWebhookSecret(): string {
  return process.env['STRIPE_WEBHOOK_SECRET']?.trim() ?? '';
}

function buildSuccessUrl(): string {
  return `${readDomainClient()}/account/subscription?status=success`;
}

function buildCancelUrl(): string {
  return `${readDomainClient()}/account/subscription?status=cancel`;
}

function buildCustomerCheckoutSessionCreateParams(
  customerId: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price: readPriceId(),
        quantity: 1,
      },
    ],
    success_url: buildSuccessUrl(),
    cancel_url: buildCancelUrl(),
    metadata: {
      customerId,
    },
  };
}

function toDate(value: number | string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function renderPublicCheckoutHtml(input: {
  title: string;
  heading: string;
  message: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${input.title}</title>
  </head>
  <body>
    <main>
      <h1>${input.heading}</h1>
      <p>${input.message}</p>
    </main>
  </body>
</html>`;
}

function publicCheckoutErrorResponse(
  status: number,
  title: string,
  heading: string,
  message: string,
): Response {
  return new Response(
    renderPublicCheckoutHtml({
      title,
      heading,
      message,
    }),
    {
      status,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
      },
    },
  );
}

function invalidPublicCheckoutLinkResponse(): Response {
  return publicCheckoutErrorResponse(
    400,
    'Invalid checkout link',
    'Checkout link unavailable',
    'Go back to WhatsApp and request a new link.',
  );
}

function missingPublicCheckoutAccountResponse(): Response {
  return publicCheckoutErrorResponse(
    404,
    'Invalid checkout link',
    'Checkout link unavailable',
    'Go back to WhatsApp and request a new link.',
  );
}

function unavailablePublicCheckoutResponse(): Response {
  return publicCheckoutErrorResponse(
    503,
    'Checkout unavailable',
    'Checkout temporarily unavailable',
    'This checkout is temporarily unavailable. Please try again later.',
  );
}

function unavailableAuthenticatedCheckoutResponse(c: Context): Response {
  return c.json({ ok: false, error: 'checkout_unavailable' }, 503);
}

function logCustomerSubscriptionError(message: string, details: Record<string, unknown>): void {
  console.error(`[customer-subscription] ${message}`, details);
}

async function loadCompatibilityCustomerAccount(
  input: {
    customerId: string;
    identityId?: string;
    requireEmailBearingIdentity?: boolean;
  },
): Promise<{
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  status: 'normal';
} | null> {
  const membership = await db.membership.findFirst({
    where: {
      customerId: input.customerId,
      ...(input.identityId ? { identityId: input.identityId } : {}),
      role: 'owner',
    },
    include: {
      customer: {
        select: {
          id: true,
          displayName: true,
        },
      },
      identity: {
        select: {
          email: true,
          claimStatus: true,
        },
      },
    },
  });

  const email = membership?.identity.email?.trim();
  if (
    !membership ||
    (!email && input.requireEmailBearingIdentity !== false) ||
    !membership.customer.id.startsWith('ck_')
  ) {
    return null;
  }

  return {
    id: membership.customer.id,
    displayName: membership.customer.displayName,
    email: email ?? '',
    emailVerified: membership.identity.claimStatus === 'active',
    status: 'normal',
  };
}

export const customerSubscriptionRouter = new Hono()
  .get('/public/subscription-checkout', async (c) => {
    const token = c.req.query('token')?.trim();
    if (!token) {
      return invalidPublicCheckoutLinkResponse();
    }

    let payload: { customerId: string };
    try {
      payload = verifyPublicCheckoutToken(token);
    } catch {
      return invalidPublicCheckoutLinkResponse();
    }

    const account = await loadCompatibilityCustomerAccount({
      customerId: payload.customerId,
      requireEmailBearingIdentity: false,
    });

    if (!account) {
      return missingPublicCheckoutAccountResponse();
    }

    try {
      const access = await resolveCokeAccountAccess({
        account: {
          id: account.id,
          status: account.status,
          emailVerified: account.emailVerified,
          displayName: account.displayName,
        },
        requireEmailVerified: false,
      });

      if (access.accountAccessDeniedReason === 'account_suspended') {
        return unavailablePublicCheckoutResponse();
      }
    } catch (error) {
      logCustomerSubscriptionError('public checkout access resolution failed', {
        customerId: account.id,
        error,
      });
      return unavailablePublicCheckoutResponse();
    }

    try {
      const session = await stripe.checkout.sessions.create(
        buildCustomerCheckoutSessionCreateParams(account.id),
      );

      if (!session.url) {
        logCustomerSubscriptionError('public checkout session missing url', {
          customerId: account.id,
          sessionId: session.id ?? null,
        });
        return unavailablePublicCheckoutResponse();
      }

      return c.redirect(session.url, 302);
    } catch (error) {
      logCustomerSubscriptionError('public checkout session creation failed', {
        customerId: account.id,
        error,
      });
      return unavailablePublicCheckoutResponse();
    }
  })
  .post('/customer/subscription/checkout', requireCustomerSubscriptionAuth, async (c) => {
    const auth = c.get('customerSubscriptionAuth');
    const account = await loadCompatibilityCustomerAccount({
      customerId: auth.customerId,
      identityId: auth.identityId,
    });

    if (!account) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    const access = await resolveCokeAccountAccess({
      account: {
        id: account.id,
        status: account.status,
        emailVerified: account.emailVerified,
        displayName: account.displayName,
      },
    });

    if (access.accountAccessDeniedReason === 'account_suspended') {
      return c.json({ ok: false, error: 'account_suspended' }, 403);
    }

    if (!account.emailVerified) {
      return c.json({ ok: false, error: 'email_not_verified' }, 403);
    }

    try {
      const session = await stripe.checkout.sessions.create(
        buildCustomerCheckoutSessionCreateParams(account.id),
      );

      if (!session.url) {
        logCustomerSubscriptionError('checkout session missing url', {
          customerId: account.id,
          sessionId: session.id ?? null,
        });
        return unavailableAuthenticatedCheckoutResponse(c);
      }

      return c.json({
        ok: true,
        data: {
          url: session.url,
        },
      });
    } catch (error) {
      logCustomerSubscriptionError('checkout session creation failed', {
        customerId: account.id,
        error,
      });
      return unavailableAuthenticatedCheckoutResponse(c);
    }
  })
  .get('/customer/subscription', requireCustomerSubscriptionAuth, async (c) => {
    const auth = c.get('customerSubscriptionAuth');
    const account = await loadCompatibilityCustomerAccount({
      customerId: auth.customerId,
      identityId: auth.identityId,
    });

    if (!account) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    const access = await resolveCokeAccountAccess({
      account: {
        id: account.id,
        status: account.status,
        emailVerified: account.emailVerified,
        displayName: account.displayName,
      },
    });

    return c.json({
      ok: true,
      data: access,
    });
  })
  .post('/webhooks/stripe', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('stripe-signature') ?? '';

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        readWebhookSecret(),
      );
    } catch (error) {
      logCustomerSubscriptionError('stripe webhook rejected', { error });
      return c.json({ ok: false, error: 'invalid_stripe_webhook' }, 400);
    }

    if (event.type !== 'checkout.session.completed') {
      return c.json({ ok: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== 'paid') {
      return c.json({ ok: true });
    }

    const customerId =
      session.metadata?.customerId?.trim() ||
      session.metadata?.cokeAccountId?.trim();
    if (!customerId) {
      return c.json({ ok: true });
    }

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;

      const latestSubscription = await tx.subscription.findFirst({
        where: { customerId },
        orderBy: [{ expiresAt: 'desc' }],
        select: { expiresAt: true },
      });
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { createdAt: true },
      });

      const now = toDate(session.created * 1000);
      const trialExpiresAt = customer ? calculateTrialExpiresAt(customer.createdAt) : null;
      const latestAccessExpiresAt =
        latestSubscription?.expiresAt && trialExpiresAt
          ? latestSubscription.expiresAt > trialExpiresAt
            ? latestSubscription.expiresAt
            : trialExpiresAt
          : latestSubscription?.expiresAt ?? trialExpiresAt;
      const stackedWindow = calculateStackedAccessWindow({
        now,
        latestExpiresAt: latestAccessExpiresAt,
      });

      try {
        await tx.subscription.create({
          data: {
            customerId,
            stripeSessionId: session.id,
            amountPaid: session.amount_total ?? 0,
            currency: session.currency ?? 'usd',
            startsAt: new Date(stackedWindow.startsAt),
            expiresAt: new Date(stackedWindow.expiresAt),
          },
        });
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error)) {
          throw error;
        }
      }
    });

    return c.json({ ok: true });
  });
