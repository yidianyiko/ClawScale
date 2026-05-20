import type { Context, Next } from 'hono';
import {
  channelServiceErrorToHttp,
  createCustomerChannelService,
} from '../channel/customer-channel-service.js';
import { db } from '../db/index.js';
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

const customerChannelService = createCustomerChannelService({ db });

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
    const response = channelServiceErrorToHttp({ code: 'unauthorized' });
    return c.json(response.body, response.status);
  }

  try {
    const payload = verifyCustomerToken(token);
    const session = await getCustomerSession(db as never, {
      customerId: payload.sub,
      identityId: payload.identityId,
    });

    if (!session) {
      const response = channelServiceErrorToHttp({ code: 'account_not_found' });
      return c.json(response.body, response.status);
    }

    if (session.claimStatus !== 'active') {
      const response = channelServiceErrorToHttp({ code: 'claim_inactive' });
      return c.json(response.body, response.status);
    }

    c.set('customerChannelAuth', session);
    await next();
    return;
  } catch {
    const response = channelServiceErrorToHttp({ code: 'invalid_or_expired_token' });
    return c.json(response.body, response.status);
  }
}

async function resolveCustomerWechatAuth(
  c: Context,
  action: PersonalWechatLifecycleAction,
): Promise<PersonalWechatLifecycleAuth> {
  const auth = c.get('customerChannelAuth');
  return customerChannelService.resolvePersonalWechatAuth({
    action,
    customerId: auth.customerId,
    identityId: auth.identityId,
  });
}

export const customerChannelRouter = createPersonalWechatChannelRouter({
  authMiddleware: requireCustomerChannelAuth,
  resolveAuth: resolveCustomerWechatAuth,
});
