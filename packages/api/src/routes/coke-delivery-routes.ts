import { Hono } from 'hono';
import { z } from 'zod';
import {
  bindBusinessConversation,
  BusinessConversationBindingError,
} from '../lib/business-conversation.js';
import { bindEndUserToCokeAccount } from '../lib/clawscale-user.js';

const bodySchema = z.object({
  tenant_id: z.string().min(1),
  conversation_id: z.string().min(1),
  account_id: z.string().min(1),
  business_conversation_key: z.string().min(1),
  channel_id: z.string().min(1),
  end_user_id: z.string().min(1),
  external_end_user_id: z.string().min(1),
});

function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  if (!('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export const cokeDeliveryRoutesRouter = new Hono();

cokeDeliveryRoutesRouter.post('/', async (c) => {
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

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    await bindEndUserToCokeAccount({
      tenantId: parsed.data.tenant_id,
      channelId: parsed.data.channel_id,
      externalId: parsed.data.external_end_user_id,
      cokeAccountId: parsed.data.account_id,
    });

    const result = await bindBusinessConversation({
      routeBinding: {
        tenantId: parsed.data.tenant_id,
        channelId: parsed.data.channel_id,
        endUserId: parsed.data.end_user_id,
        externalEndUserId: parsed.data.external_end_user_id,
        cokeAccountId: parsed.data.account_id,
        customerId: null,
        gatewayConversationId: parsed.data.conversation_id,
        businessConversationKey: null,
        previousBusinessConversationKey: null,
        previousClawscaleUserId: null,
      },
      businessConversationKey: parsed.data.business_conversation_key,
    });

    return c.json({
      ok: true,
      data: {
        tenant_id: result.tenantId,
        account_id: result.cokeAccountId,
        business_conversation_key: result.businessConversationKey,
        channel_id: result.channelId,
        end_user_id: result.endUserId,
        external_end_user_id: result.externalEndUserId,
        is_active: result.isActive,
      },
    });
  } catch (err) {
    const code = readErrorCode(err);
    if (code === 'end_user_not_found') {
      return c.json({ ok: false, error: code }, 404);
    }
    if (code === 'end_user_already_bound') {
      return c.json({ ok: false, error: code }, 409);
    }
    if (code === 'conversation_not_found') {
      return c.json({ ok: false, error: code }, 404);
    }
    if (err instanceof BusinessConversationBindingError && code) {
      return c.json({ ok: false, error: code }, 409);
    }
    if (code) {
      return c.json({ ok: false, error: code }, code === 'conversation_not_found' ? 404 : 409);
    }
    throw err;
  }
});
