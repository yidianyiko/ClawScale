import Stripe from 'stripe';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { requireCokeUserAuth } from '../middleware/coke-user-auth.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { calculateStackedAccessWindow } from '../lib/coke-subscription.js';

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

function toDate(value: number | string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

async function loadCompatibilityCustomerAccount(customerId: string): Promise<{
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  status: 'normal' | 'suspended';
} | null> {
  const [membership, cokeAccount] = await Promise.all([
    db.membership.findFirst({
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
    }),
    db.cokeAccount.findUnique({
      where: { id: customerId },
      select: { status: true },
    }),
  ]);

  const email = membership?.identity.email?.trim();
  if (!membership || !email) {
    return null;
  }

  return {
    id: membership.customer.id,
    displayName: membership.customer.displayName,
    email,
    emailVerified: membership.identity.claimStatus === 'active',
    status: cokeAccount?.status ?? 'normal',
  };
}

export const cokePaymentRouter = new Hono()
  .post('/checkout', requireCokeUserAuth, async (c) => {
    const auth = c.get('cokeAuth');
    const account = await loadCompatibilityCustomerAccount(auth.accountId);

    if (!account) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }

    if (account.status === 'suspended') {
      return c.json({ ok: false, error: 'account_suspended' }, 403);
    }

    if (!account.emailVerified) {
      return c.json({ ok: false, error: 'email_not_verified' }, 403);
    }

    const session = await stripe.checkout.sessions.create({
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
        customerId: account.id,
      },
    });

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

      const now = toDate(session.created * 1000);
      const stackedWindow = calculateStackedAccessWindow({
        now,
        latestExpiresAt: latestSubscription?.expiresAt ?? null,
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
