import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import {
  getCustomerSession,
  verifyCustomerToken,
  type CustomerSession,
} from '../lib/customer-auth.js';
import {
  disableUserLink,
  getOrCreateActiveUserLink,
  resetUserLink,
} from '../scheduling/user-link-service.js';

declare module 'hono' {
  interface ContextVariableMap {
    customerSchedulingAuth: CustomerSession;
  }
}

export const customerSchedulingRouter = new Hono();

function readBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function requireCustomerSchedulingAuth(c: Context, next: Next): Promise<Response | void> {
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

    c.set('customerSchedulingAuth', session);
    await next();
    return;
  } catch {
    return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
  }
}

function retiredAppointmentSchedulingResponse(c: Context): Response {
  return c.json({ ok: false, error: 'appointment_scheduling_retired' }, 410);
}

customerSchedulingRouter.use('*', requireCustomerSchedulingAuth);

customerSchedulingRouter.get('/user-link', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const result = await getOrCreateActiveUserLink(db as never, {
    providerAccountId: session.customerId,
  });
  return c.json({ ok: true, data: result });
});

customerSchedulingRouter.post('/user-link/reset', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const result = await resetUserLink(db as never, {
    providerAccountId: session.customerId,
  });
  return c.json({ ok: true, data: result });
});

customerSchedulingRouter.post('/user-link/disable', async (c) => {
  const session = c.get('customerSchedulingAuth');
  const result = await disableUserLink(db as never, {
    providerAccountId: session.customerId,
  });
  return c.json({ ok: true, data: result });
});

customerSchedulingRouter.post('/bookable-windows/preview', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/bookable-windows/confirm', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.get('/bookable-windows', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.get('/appointments/pending', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments/:id/confirm', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments/:id/reject', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/appointments/:id/cancel', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/service-links/:otherAccountId/block', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.post('/service-links/:otherAccountId/unblock', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});

customerSchedulingRouter.delete('/service-links/:otherAccountId', async (c) => {
  return retiredAppointmentSchedulingResponse(c);
});
