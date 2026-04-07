import { Hono } from 'hono';
import { z } from 'zod';
import { bindEndUserToCokeAccount, ClawscaleUserBindingError } from '../lib/clawscale-user.js';

const bodySchema = z.object({
  tenant_id: z.string().min(1),
  channel_id: z.string().min(1),
  external_id: z.string().min(1),
  coke_account_id: z.string().min(1),
});

function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  if (!('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export const cokeBindingsRouter = new Hono();

cokeBindingsRouter.post('/', async (c) => {
  const expected = process.env['CLAWSCALE_IDENTITY_API_KEY'] ?? '';
  if (c.req.header('Authorization') !== `Bearer ${expected}`) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = bodySchema.parse(await c.req.json());

  try {
    const result = await bindEndUserToCokeAccount({
      tenantId: body.tenant_id,
      channelId: body.channel_id,
      externalId: body.external_id,
      cokeAccountId: body.coke_account_id,
    });

    return c.json({
      ok: true,
      data: {
        clawscale_user_id: result.clawscaleUserId,
        end_user_id: result.endUserId,
        coke_account_id: result.cokeAccountId,
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
    if (err instanceof ClawscaleUserBindingError) {
      return c.json({ ok: false, error: err.code }, err.code === 'end_user_not_found' ? 404 : 409);
    }
    throw err;
  }
});
