import type { Context, Next } from 'hono';
import { db } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { ensureClawscaleUserForCustomer } from '../lib/clawscale-user.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';
import {
  createPersonalWechatChannelRouter,
  type PersonalWechatLifecycleAction,
  type PersonalWechatLifecycleAuth,
} from './user-wechat-channel.js';

declare module 'hono' {
  interface ContextVariableMap {
    customerChannelAuth: CustomerSession;
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

async function requireCustomerChannelAuth(c: Context, next: Next): Promise<Response | void> {
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

    c.set('customerChannelAuth', session);
    await next();
    return;
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }
}

function shouldGateProvisioning(action: PersonalWechatLifecycleAction): boolean {
  return action === 'create' || action === 'connect';
}

function enforceAccessForAction(
  action: PersonalWechatLifecycleAction,
  deniedReason: string | null,
): void {
  if (!shouldGateProvisioning(action)) {
    return;
  }

  if (deniedReason === 'account_suspended') {
    throw new Error('account_suspended');
  }

  if (deniedReason === 'email_not_verified') {
    throw new Error('email_not_verified');
  }

  if (action === 'connect' && deniedReason === 'subscription_required') {
    throw new Error('subscription_required');
  }
}

async function loadCompatibilityCustomerAccount(input: {
  customerId: string;
  identityId: string;
}): Promise<{
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  status: 'normal';
} | null> {
  const membership = await db.membership.findFirst({
    where: {
      customerId: input.customerId,
      identityId: input.identityId,
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
  if (!membership || !email || !membership.customer.id.startsWith('ck_')) {
    return null;
  }

  return {
    id: membership.customer.id,
    displayName: membership.customer.displayName,
    email,
    emailVerified: membership.identity.claimStatus === 'active',
    status: 'normal',
  };
}

async function resolveCustomerWechatAuth(
  c: Context,
  action: PersonalWechatLifecycleAction,
): Promise<PersonalWechatLifecycleAuth> {
  const auth = c.get('customerChannelAuth');
  const account = await loadCompatibilityCustomerAccount({
    customerId: auth.customerId,
    identityId: auth.identityId,
  });

  if (!account) {
    throw new Error('account_not_found');
  }

  const access = await resolveCokeAccountAccess({
    account: {
      id: account.id,
      status: account.status,
      emailVerified: account.emailVerified,
      displayName: account.displayName,
    },
  });

  enforceAccessForAction(action, access.accountAccessDeniedReason);

  const ensured = await ensureClawscaleUserForCustomer({
    customerId: account.id,
  });

  return {
    tenantId: ensured.tenantId,
    clawscaleUserId: ensured.clawscaleUserId,
  };
}

export const customerChannelRouter = createPersonalWechatChannelRouter({
  authMiddleware: requireCustomerChannelAuth,
  resolveAuth: resolveCustomerWechatAuth,
});
