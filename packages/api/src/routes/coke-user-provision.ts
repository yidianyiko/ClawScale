import { Hono } from 'hono';
import { z } from 'zod';
import { ensureClawscaleUserForCokeAccount } from '../lib/clawscale-user.js';

const bodySchema = z.object({
  coke_account_id: z.string().trim().min(1).optional(),
  account_id: z.string().trim().min(1).optional(),
  customer_id: z.string().trim().min(1).optional(),
  display_name: z.string().trim().min(1).max(120).optional(),
});

function resolveCompatibilityId(payload: z.infer<typeof bodySchema>): string | null {
  return payload.customer_id ?? payload.account_id ?? payload.coke_account_id ?? null;
}

function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return undefined;
  }

  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

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
  const cokeAccountId = parsed.success ? resolveCompatibilityId(parsed.data) : null;
  if (!parsed.success || !cokeAccountId) {
    return c.json({ ok: false, error: 'invalid_body' }, 400);
  }

  try {
    const result = await ensureClawscaleUserForCokeAccount({
      cokeAccountId,
      displayName: parsed.data.display_name,
    });

    if (!result.ready) {
      return c.json({ ok: false, error: 'provision_not_ready' }, 503);
    }

    return c.json({
      ok: true,
      data: {
        tenant_id: result.tenantId,
        clawscale_user_id: result.clawscaleUserId,
      },
    });
  } catch (err) {
    const code = readErrorCode(err);
    if (code === 'coke_account_not_found') {
      return c.json({ ok: false, error: code }, 404);
    }

    throw err;
  }
});
