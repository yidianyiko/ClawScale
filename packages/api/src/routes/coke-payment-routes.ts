import Stripe from 'stripe';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { requireCokeUserAuth } from '../middleware/coke-user-auth.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { verifyPublicCheckoutToken } from '../lib/coke-public-checkout.js';
import {
  calculateStackedAccessWindow,
  calculateTrialExpiresAt,
} from '../lib/coke-subscription.js';

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '');

function isPrismaUniqueConstraintError(error: unknown): error is { code: string } {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
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
  return `${readDomainClient()}/coke/payment-success`;
}

function buildCancelUrl(): string {
  return `${readDomainClient()}/coke/payment-cancel`;
}

function buildCokeCheckoutSessionCreateParams(
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

function logPublicCheckoutError(message: string, details: Record<string, unknown>): void {
  console.error(`[coke-payment] ${message}`, details);
}

async function loadCompatibilityCustomerAccount(
  customerId: string,
  options?: {
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
      customerId,
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
    (!email && options?.requireEmailBearingIdentity !== false) ||
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

export const cokePaymentRouter = new Hono()
  .get('/public-checkout', async (c) => {
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

    const account = await loadCompatibilityCustomerAccount(payload.customerId, {
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
      logPublicCheckoutError('public checkout access resolution failed', {
        customerId: account.id,
        error,
      });
      return unavailablePublicCheckoutResponse();
    }

    try {
      const session = await stripe.checkout.sessions.create(
        buildCokeCheckoutSessionCreateParams(account.id),
      );

      if (!session.url) {
        logPublicCheckoutError('public checkout session missing url', {
          customerId: account.id,
          sessionId: session.id ?? null,
        });
        return unavailablePublicCheckoutResponse();
      }

      return c.redirect(session.url, 302);
    } catch (error) {
      logPublicCheckoutError('public checkout session creation failed', {
        customerId: account.id,
        error,
      });
      return unavailablePublicCheckoutResponse();
    }
  })
  .post('/checkout', requireCokeUserAuth, async (c) => {
    const auth = c.get('cokeAuth');
    const account = await loadCompatibilityCustomerAccount(auth.accountId);

    if (!account) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    if (!account.emailVerified) {
      return c.json({ ok: false, error: 'email_not_verified' }, 403);
    }

    const session = await stripe.checkout.sessions.create(
      buildCokeCheckoutSessionCreateParams(account.id),
    );

    return c.json({
      ok: true,
      data: {
        url: session.url,
      },
    });
  })
  .get('/subscription', requireCokeUserAuth, async (c) => {
    const auth = c.get('cokeAuth');
    const account = await loadCompatibilityCustomerAccount(auth.accountId);

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
  .post('/stripe-webhook', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('stripe-signature') ?? '';

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      readWebhookSecret(),
    );

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
