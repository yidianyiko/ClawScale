import { Hono, type Context } from 'hono';
import { db } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { ensureClawscaleUserForCustomer } from '../lib/clawscale-user.js';
import { requireCokeUserAuth } from '../middleware/coke-user-auth.js';
import {
  createPersonalWechatChannelRouter,
  type PersonalWechatLifecycleAction,
  type PersonalWechatLifecycleAuth,
} from './user-wechat-channel.js';

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

async function loadCompatibilityCustomerAccount(customerId: string): Promise<{
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

async function resolveCokeWechatAuth(
  c: Context,
  action: PersonalWechatLifecycleAction,
): Promise<PersonalWechatLifecycleAuth> {
  const auth = c.get('cokeAuth');
  const account = await loadCompatibilityCustomerAccount(auth.accountId);

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

function resolveWechatSuccessorPath(path: string, method: string): string {
  if (path.endsWith('/connect')) {
    return '/api/customer/channels/wechat-personal/connect';
  }

  if (path.endsWith('/disconnect')) {
    return '/api/customer/channels/wechat-personal/disconnect';
  }

  if (path.endsWith('/status')) {
    return '/api/customer/channels/wechat-personal/status';
  }

  return '/api/customer/channels/wechat-personal';
}

function applyDeprecationHeaders(c: Context): void {
  c.header('Deprecation', 'true');
  c.header('Link', `<${resolveWechatSuccessorPath(c.req.path, c.req.method)}>; rel="successor-version"`);
}

const cokeWechatLifecycleRouter = createPersonalWechatChannelRouter({
  authMiddleware: requireCokeUserAuth,
  resolveAuth: resolveCokeWechatAuth,
});

export const cokeWechatRouter = new Hono()
  .use('*', async (c, next) => {
    applyDeprecationHeaders(c);
    await next();
  })
  .route('/', cokeWechatLifecycleRouter);
