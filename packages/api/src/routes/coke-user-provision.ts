import { Hono } from 'hono';
import { z } from 'zod';
import { ensureClawscaleUserForCokeAccount } from '../lib/clawscale-user.js';

const bodySchema = z.object({
  coke_account_id: z.string().min(1),
  display_name: z.string().trim().min(1).max(120).optional(),
});

export const cokeUserProvisionRouter = new Hono();

cokeUserProvisionRouter.post('/', async (c) => {
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

  const result = await ensureClawscaleUserForCokeAccount({
    cokeAccountId: parsed.data.coke_account_id,
    displayName: parsed.data.display_name,
  });

  return c.json({
    ok: true,
    data: {
      tenant_id: result.tenantId,
      clawscale_user_id: result.clawscaleUserId,
    },
  });
});
