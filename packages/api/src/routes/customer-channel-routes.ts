import type { Context, Next } from 'hono';
import { db } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import {
  ensureClawscaleUserForCokeAccount,
  ensureClawscaleUserForCustomer,
} from '../lib/clawscale-user.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';
import { verifyCokeToken } from '../lib/coke-auth.js';
import {
  createPersonalWechatChannelRouter,
  type PersonalWechatLifecycleAction,
  type PersonalWechatLifecycleAuth,
} from './user-wechat-channel.js';

type ChannelCompatibilityAuth =
  | { kind: 'customer'; session: CustomerSession }
  | { kind: 'coke'; accountId: string; email: string };

declare module 'hono' {
  interface ContextVariableMap {
    customerChannelAuth: ChannelCompatibilityAuth;
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

    c.set('customerChannelAuth', { kind: 'customer', session });
    await next();
    return;
  } catch {
    try {
      const payload = verifyCokeToken(token);
      c.set('customerChannelAuth', {
        kind: 'coke',
        accountId: payload.sub,
        email: payload.email,
      });
      await next();
      return;
    } catch {
      return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
    }
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

async function resolveCustomerWechatAuth(
  c: Context,
  action: PersonalWechatLifecycleAction,
): Promise<PersonalWechatLifecycleAuth> {
  const auth = c.get('customerChannelAuth');
  const accountId = auth.kind === 'customer' ? auth.session.customerId : auth.accountId;
  const account = await db.cokeAccount.findUnique({
    where: { id: accountId },
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

  const ensured = auth.kind === 'customer'
    ? await ensureClawscaleUserForCustomer({
        customerId: auth.session.customerId,
      })
    : account.id.startsWith('ck_')
      ? await ensureClawscaleUserForCustomer({
          customerId: account.id,
        })
      : await ensureClawscaleUserForCokeAccount({
          cokeAccountId: account.id,
          displayName: account.displayName,
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
