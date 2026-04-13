import type { Context } from 'hono';
import { db } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { ensureClawscaleUserForCokeAccount } from '../lib/clawscale-user.js';
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

async function resolveCokeWechatAuth(
  c: Context,
  action: PersonalWechatLifecycleAction,
): Promise<PersonalWechatLifecycleAuth> {
  const auth = c.get('cokeAuth');
  const account = await db.cokeAccount.findUnique({
    where: { id: auth.accountId },
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

  const ensured = await ensureClawscaleUserForCokeAccount({
    cokeAccountId: account.id,
    displayName: account.displayName,
  });

  return {
    tenantId: ensured.tenantId,
    clawscaleUserId: ensured.clawscaleUserId,
  };
}

export const cokeWechatRouter = createPersonalWechatChannelRouter({
  authMiddleware: requireCokeUserAuth,
  resolveAuth: resolveCokeWechatAuth,
});
