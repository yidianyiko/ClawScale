import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  CalendarImportHandoffError,
  claimCalendarImportHandoff,
  createCalendarImportHandoff,
} from '../lib/calendar-import-handoff.js';
import {
  getCustomerSession,
  verifyCustomerToken,
} from '../lib/customer-auth.js';

const createSchema = z.object({
  source_customer_id: z.string().min(1),
  tenant_id: z.string().min(1),
  channel_id: z.string().min(1),
  end_user_id: z.string().min(1),
  external_id: z.string().min(1),
  gateway_conversation_id: z.string().min(1),
  business_conversation_key: z.string().min(1),
});

const claimSchema = z.object({
  token: z.string().min(1),
});

function readBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim() || null;
}

function mapHandoffError(error: unknown): { status: 400 | 401 | 403 | 404 | 409; error: string } {
  if (!(error instanceof CalendarImportHandoffError)) {
    throw error;
  }
  switch (error.code) {
    case 'invalid_handoff':
      return { status: 404, error: error.code };
    case 'expired_handoff':
    case 'handoff_already_consumed':
      return { status: 409, error: error.code };
    case 'account_not_active':
      return { status: 403, error: error.code };
    case 'identity_already_bound':
      return { status: 409, error: error.code };
  }
}

export const internalCalendarImportHandoffRouter = new Hono()
  .post('/', async (c) => {
    const expected = process.env['CLAWSCALE_IDENTITY_API_KEY'] ?? '';
    if (c.req.header('Authorization') !== `Bearer ${expected}`) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const parsed = createSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const result = await createCalendarImportHandoff(db as never, {
      sourceCustomerId: parsed.data.source_customer_id,
      tenantId: parsed.data.tenant_id,
      channelId: parsed.data.channel_id,
      endUserId: parsed.data.end_user_id,
      externalId: parsed.data.external_id,
      gatewayConversationId: parsed.data.gateway_conversation_id,
      businessConversationKey: parsed.data.business_conversation_key,
    });

    return c.json({
      ok: true,
      data: {
        url: result.url,
        expires_at: result.session.expiresAt.toISOString(),
      },
    });
  });

export const customerCalendarImportHandoffRouter = new Hono()
  .post('/claim', async (c) => {
    const bearer = readBearerToken(c.req.header('Authorization'));
    if (!bearer) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    let payload;
    try {
      payload = verifyCustomerToken(bearer);
    } catch {
      return c.json({ ok: false, error: 'invalid_or_expired_token' }, 401);
    }

    const session = await getCustomerSession(db as never, {
      customerId: payload.sub,
      identityId: payload.identityId,
    });
    if (!session) {
      return c.json({ ok: false, error: 'account_not_found' }, 404);
    }
    if (session.claimStatus !== 'active') {
      return c.json({ ok: false, error: 'account_not_active' }, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    const parsed = claimSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_body' }, 400);
    }

    try {
      const result = await claimCalendarImportHandoff(db as never, {
        token: parsed.data.token,
        customerId: session.customerId,
        identityId: session.identityId,
      });
      return c.json({
        ok: true,
        data: {
          status: result.session.status,
          continue_to: `/account/calendar-import?handoff=${encodeURIComponent(parsed.data.token)}`,
        },
      });
    } catch (error) {
      const mapped = mapHandoffError(error);
      return c.json({ ok: false, error: mapped.error }, mapped.status);
    }
  });
