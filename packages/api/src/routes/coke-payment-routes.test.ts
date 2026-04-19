import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const db = vi.hoisted(() => ({
  membership: {
    findFirst: vi.fn(),
  },
  customer: {
    findUnique: vi.fn(),
  },
  subscription: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

const resolveCokeAccountAccess = vi.hoisted(() => vi.fn());
const calculateStackedAccessWindow = vi.hoisted(() => vi.fn());
const calculateTrialExpiresAt = vi.hoisted(() =>
  vi.fn((createdAt: Date) => new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)),
);
const verifyCokeToken = vi.hoisted(() => vi.fn());
const stripeCheckoutSessionsCreate = vi.hoisted(() => vi.fn());
const stripeConstructEvent = vi.hoisted(() => vi.fn());
const stripeCtor = vi.hoisted(() =>
  vi.fn(() => ({
    checkout: {
      sessions: {
        create: stripeCheckoutSessionsCreate,
      },
    },
    webhooks: {
      constructEvent: stripeConstructEvent,
    },
  })),
);

vi.mock('../db/index.js', () => ({ db }));
vi.mock('../lib/coke-auth.js', () => ({ verifyCokeToken }));
vi.mock('../lib/coke-account-access.js', () => ({ resolveCokeAccountAccess }));
vi.mock('../lib/coke-subscription.js', () => ({
  calculateStackedAccessWindow,
  calculateTrialExpiresAt,
}));
vi.mock('stripe', () => ({ default: stripeCtor }));

import { cokePaymentRouter } from './coke-payment-routes.js';

function makeOwnerMembership(claimStatus: 'active' | 'pending' | 'unclaimed') {
  return {
    role: 'owner',
    customer: {
      id: 'ck_1',
      displayName: 'Alice',
    },
    identity: {
      id: 'idt_1',
      email: 'alice@example.com',
      claimStatus,
    },
  };
}

describe('coke payment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_CLIENT = 'https://coke.example';
    process.env.STRIPE_PRICE_ID = 'price_coke_monthly';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
  });

  it('rejects checkout requests without Coke auth', async () => {
    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/checkout', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('rejects checkout when the owner identity is unverified', async () => {
    verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
    });
    db.membership.findFirst.mockResolvedValue(makeOwnerMembership('pending'));

    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(403);
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_1',
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
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'email_not_verified',
    });
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('returns account_not_found when the neutral owner membership is missing', async () => {
    verifyCokeToken.mockReturnValue({
      sub: 'acct_missing',
      email: 'missing@example.com',
    });
    db.membership.findFirst.mockResolvedValue(null);

    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'account_not_found',
    });
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('creates a Stripe Checkout session for a verified customer owner', async () => {
    verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
    });
    db.membership.findFirst.mockResolvedValue(makeOwnerMembership('active'));
    stripeCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://stripe.example/checkout/session_123',
    });

    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(200);
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_1',
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
    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledWith({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: 'price_coke_monthly',
          quantity: 1,
        },
      ],
      success_url: 'https://coke.example/coke/payment-success',
      cancel_url: 'https://coke.example/coke/payment-cancel',
      metadata: {
        customerId: 'ck_1',
      },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        url: 'https://stripe.example/checkout/session_123',
      },
    });
  });

  it('returns the subscription snapshot from the customer owner graph', async () => {
    verifyCokeToken.mockReturnValue({
      sub: 'ck_1',
      email: 'alice@example.com',
    });
    db.membership.findFirst.mockResolvedValue(makeOwnerMembership('active'));
    resolveCokeAccountAccess.mockResolvedValue({
      accountStatus: 'normal',
      emailVerified: true,
      subscriptionActive: true,
      subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
      accountAccessAllowed: true,
      accountAccessDeniedReason: null,
      renewalUrl: 'https://coke.example/coke/renew',
    });

    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/subscription', {
      headers: {
        authorization: 'Bearer coke-token',
      },
    });

    expect(res.status).toBe(200);
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'ck_1',
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
    expect(resolveCokeAccountAccess).toHaveBeenCalledWith({
      account: {
        id: 'ck_1',
        displayName: 'Alice',
        emailVerified: true,
        status: 'normal',
      },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        accountStatus: 'normal',
        emailVerified: true,
        subscriptionActive: true,
        subscriptionExpiresAt: '2026-05-10T00:00:00.000Z',
        accountAccessAllowed: true,
        accountAccessDeniedReason: null,
        renewalUrl: 'https://coke.example/coke/renew',
      },
    });
  });

  it('accepts legacy Stripe metadata.cokeAccountId during the transition window', async () => {
    stripeConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_legacy',
          payment_status: 'paid',
          created: 1712707200,
          amount_total: 1299,
          currency: 'usd',
          metadata: {
            cokeAccountId: 'ck_1',
          },
        },
      },
    });
    db.$queryRaw.mockResolvedValue([{ id: 'ck_1' }]);
    db.subscription.findFirst.mockResolvedValue({
      expiresAt: new Date('2026-05-10T00:00:00.000Z'),
    });
    calculateStackedAccessWindow.mockReturnValue({
      startsAt: '2026-05-10T00:00:00.000Z',
      expiresAt: '2026-06-09T00:00:00.000Z',
    });
    db.subscription.create.mockResolvedValue({ id: 'sub_1' });

    const tx = {
      $queryRaw: db.$queryRaw,
      customer: db.customer,
      subscription: db.subscription,
    };
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    );

    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/stripe-webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'sig_test_123',
      },
      body: JSON.stringify({
        id: 'evt_legacy',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.subscription.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'ck_1' },
      orderBy: [{ expiresAt: 'desc' }],
      select: { expiresAt: true },
    });
    expect(db.subscription.create).toHaveBeenCalledWith({
      data: {
        customerId: 'ck_1',
        stripeSessionId: 'cs_test_legacy',
        amountPaid: 1299,
        currency: 'usd',
        startsAt: new Date('2026-05-10T00:00:00.000Z'),
        expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      },
    });
  });

  it('swallows duplicate Stripe session webhook inserts', async () => {
    stripeConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          created: 1712707200,
          amount_total: 1299,
          currency: 'usd',
          metadata: {
            customerId: 'ck_1',
          },
        },
      },
    });
    db.$queryRaw.mockResolvedValue([{ id: 'ck_1' }]);
    db.subscription.findFirst.mockResolvedValue({
      expiresAt: new Date('2026-05-10T00:00:00.000Z'),
    });
    calculateStackedAccessWindow.mockReturnValue({
      startsAt: '2026-05-10T00:00:00.000Z',
      expiresAt: '2026-06-09T00:00:00.000Z',
    });
    db.subscription.create.mockRejectedValue({
      code: 'P2002',
    });

    const tx = {
      $queryRaw: db.$queryRaw,
      customer: db.customer,
      subscription: db.subscription,
    };
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    );

    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/stripe-webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'sig_test_123',
      },
      body: JSON.stringify({
        id: 'evt_1',
      }),
    });

    expect(res.status).toBe(200);
    expect(stripeConstructEvent).toHaveBeenCalledWith(
      JSON.stringify({ id: 'evt_1' }),
      'sig_test_123',
      'whsec_test_123',
    );
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.subscription.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'ck_1' },
      orderBy: [{ expiresAt: 'desc' }],
      select: { expiresAt: true },
    });
    expect(calculateStackedAccessWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        now: expect.any(Date),
        latestExpiresAt: new Date('2026-05-10T00:00:00.000Z'),
      }),
    );
    expect(db.subscription.create).toHaveBeenCalledWith({
      data: {
        customerId: 'ck_1',
        stripeSessionId: 'cs_test_123',
        amountPaid: 1299,
        currency: 'usd',
        startsAt: new Date('2026-05-10T00:00:00.000Z'),
        expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      },
    });
    expect(String(db.$queryRaw.mock.calls[0]?.[0])).toContain('FROM customers');
  });

  it('stacks paid access after the remaining trial window when checkout completes during trial', async () => {
    stripeConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_trial',
          payment_status: 'paid',
          created: 1775088000,
          amount_total: 1299,
          currency: 'usd',
          metadata: {
            customerId: 'ck_1',
          },
        },
      },
    });
    db.$queryRaw.mockResolvedValue([{ id: 'ck_1' }]);
    db.customer.findUnique.mockResolvedValue({
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    db.subscription.findFirst.mockResolvedValue(null);
    calculateStackedAccessWindow.mockReturnValue({
      startsAt: '2026-04-08T00:00:00.000Z',
      expiresAt: '2026-05-08T00:00:00.000Z',
    });
    db.subscription.create.mockResolvedValue({ id: 'sub_trial' });

    const tx = {
      $queryRaw: db.$queryRaw,
      customer: db.customer,
      subscription: db.subscription,
    };
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    );

    const app = new Hono();
    app.route('/api/coke', cokePaymentRouter);

    const res = await app.request('/api/coke/stripe-webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'sig_test_trial',
      },
      body: JSON.stringify({
        id: 'evt_trial',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'ck_1' },
      select: { createdAt: true },
    });
    expect(calculateStackedAccessWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        latestExpiresAt: new Date('2026-04-08T00:00:00.000Z'),
      }),
    );
    expect(db.subscription.create).toHaveBeenCalledWith({
      data: {
        customerId: 'ck_1',
        stripeSessionId: 'cs_test_trial',
        amountPaid: 1299,
        currency: 'usd',
        startsAt: new Date('2026-04-08T00:00:00.000Z'),
        expiresAt: new Date('2026-05-08T00:00:00.000Z'),
      },
    });
  });
});
