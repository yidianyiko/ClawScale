import type { Context } from 'hono';
import { ensureClawscaleUserForCustomer } from '../lib/clawscale-user.js';
import { requireCustomerAuth } from '../middleware/customer-auth.js';
import {
  createPersonalWechatChannelRouter,
  type PersonalWechatLifecycleAction,
  type PersonalWechatLifecycleAuth,
} from './user-wechat-channel.js';

async function resolveCustomerWechatAuth(
  c: Context,
  _action: PersonalWechatLifecycleAction,
): Promise<PersonalWechatLifecycleAuth> {
  const auth = c.get('customerAuth');
  // Compatibility window: neutral customers still need a legacy-compatible
  // personal tenant/user projection before the lifecycle can run.
  const ensured = await ensureClawscaleUserForCustomer({
    customerId: auth.customerId,
  });

  return {
    tenantId: ensured.tenantId,
    clawscaleUserId: ensured.clawscaleUserId,
  };
}

export const customerChannelRouter = createPersonalWechatChannelRouter({
  authMiddleware: requireCustomerAuth,
  resolveAuth: resolveCustomerWechatAuth,
});
