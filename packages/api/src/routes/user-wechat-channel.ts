import { Hono, type Context, type MiddlewareHandler, type Next } from 'hono';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  archivePersonalWeChatChannel,
  createOrReusePersonalWeChatChannel,
  disconnectPersonalWeChatChannel,
} from '../lib/personal-wechat-channel.js';
import { ensureClawscaleUserForCokeAccount } from '../lib/clawscale-user.js';
import {
  getWeixinQR,
  getWeixinStatus,
  getWeixinRestoreState,
  startWeixinQR,
  stopWeixinBot,
} from '../adapters/wechat.js';

const PERSONAL_CHANNEL_TYPE = 'wechat_personal' as const;
const PERSONAL_CHANNEL_SCOPE = 'personal' as const;

type LifecycleStatus =
  | 'missing'
  | 'disconnected'
  | 'pending'
  | 'connected'
  | 'error'
  | 'archived';

type CurrentChannelRow = {
  id: string;
  type: string;
  scope?: string | null;
  ownerClawscaleUserId?: string | null;
  status: string;
  updatedAt: Date;
};

export type PersonalWechatLifecycleAction =
  | 'create'
  | 'connect'
  | 'status'
  | 'disconnect'
  | 'delete';

export interface PersonalWechatLifecycleAuth {
  tenantId: string;
  clawscaleUserId: string;
}

interface PersonalWechatChannelRouterOptions {
  authMiddleware: MiddlewareHandler;
  resolveAuth: (
    c: Context,
    action: PersonalWechatLifecycleAction,
  ) => Promise<PersonalWechatLifecycleAuth>;
}

function assertValidPersonalChannelRow(row: CurrentChannelRow): void {
  if (row.type !== PERSONAL_CHANNEL_TYPE) {
    throw new Error('invalid_personal_channel_row');
  }

  if (row.scope !== PERSONAL_CHANNEL_SCOPE) {
    throw new Error('invalid_personal_channel_row');
  }

  if (!row.ownerClawscaleUserId) {
    throw new Error('invalid_personal_channel_row');
  }
}

async function requireUserWechatChannelAuth(c: Context, next: Next): Promise<Response | void> {
  const expected = process.env['CLAWSCALE_IDENTITY_API_KEY'] ?? '';
  if (c.req.header('Authorization') === `Bearer ${expected}`) {
    await next();
    return;
  }

  return requireAuth(c, next);
}

async function readBridgeAuth(
  c: Context,
  _action: PersonalWechatLifecycleAction,
): Promise<PersonalWechatLifecycleAuth> {
  const auth = c.get('auth');
  if (auth) {
    return {
      tenantId: auth.tenantId,
      clawscaleUserId: auth.userId,
    };
  }

  let accountId: string | undefined;
  if (c.req.method === 'GET') {
    accountId = c.req.query('account_id')?.trim();
  } else {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw new Error('invalid_body');
    }

    if (typeof rawBody !== 'object' || rawBody === null) {
      throw new Error('invalid_body');
    }

    const candidate = (rawBody as { account_id?: unknown }).account_id;
    if (typeof candidate === 'string') {
      accountId = candidate.trim();
    }
  }

  if (!accountId) {
    throw new Error('invalid_body');
  }

  const ensured = await ensureClawscaleUserForCokeAccount({
    cokeAccountId: accountId,
  });

  return {
    tenantId: ensured.tenantId,
    clawscaleUserId: ensured.clawscaleUserId,
  };
}

function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return undefined;
  }

  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function respondLifecycleError(c: Context, err: unknown) {
  const code = readErrorCode(err) ?? (err instanceof Error ? err.message : undefined);

  if (
    code === 'coke_account_not_found' ||
    code === 'account_not_found' ||
    code === 'customer_not_found'
  ) {
    return c.json({ ok: false, error: code }, 404);
  }

  if (code === 'clawscale_user_not_found' || code === 'personal_channel_not_found') {
    return c.json({ ok: false, error: code }, 404);
  }

  if (code === 'account_suspended' || code === 'email_not_verified') {
    return c.json({ ok: false, error: code }, 403);
  }

  if (code === 'subscription_required') {
    return c.json({ ok: false, error: code }, 402);
  }

  if (code === 'duplicate_personal_channel_rows' || code === 'disconnect_before_archive') {
    return c.json({ ok: false, error: code }, 409);
  }

  if (code === 'invalid_personal_channel_row') {
    return c.json({ ok: false, error: code }, 500);
  }

  if (code === 'invalid_body') {
    return c.json({ ok: false, error: code }, 400);
  }

  return null;
}

function resolveStatus(
  rowStatus: string,
  liveStatus: ReturnType<typeof getWeixinStatus>,
  restoreState: ReturnType<typeof getWeixinRestoreState>,
): LifecycleStatus {
  if (rowStatus === 'archived') {
    return 'archived';
  }

  if (liveStatus === 'connected') {
    return 'connected';
  }

  if (liveStatus === 'error') {
    return 'error';
  }

  if (liveStatus === 'disconnected') {
    return 'disconnected';
  }

  if (liveStatus === 'qr_pending') {
    return 'pending';
  }

  if (rowStatus === 'connected') {
    return restoreState === 'initializing' ? 'connected' : 'disconnected';
  }

  switch (rowStatus) {
    case 'error':
      return 'error';
    case 'pending':
      return 'error';
    case 'disconnected':
      return 'disconnected';
    default:
      return 'disconnected';
  }
}

function buildLifecyclePayload(
  channelId: string | null,
  status: LifecycleStatus,
  qr: { image: string; url: string } | null,
) {
  return {
    channel_id: channelId,
    status,
    qr: status === 'pending' ? qr?.image ?? null : null,
    qr_url: status === 'pending' ? qr?.url ?? null : null,
    ...(status === 'pending' ? { connect_url: qr?.url ?? null } : {}),
  };
}

async function waitForWeixinQR(channelId: string, timeoutMs = 10_000) {
  let qr = getWeixinQR(channelId);
  if (qr || getWeixinStatus(channelId) !== 'qr_pending') {
    return qr;
  }

  await new Promise<void>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      qr = getWeixinQR(channelId);
      if (qr || getWeixinStatus(channelId) !== 'qr_pending' || Date.now() > deadline) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });

  return qr;
}

async function loadCurrentPersonalChannel(input: {
  tenantId: string;
  clawscaleUserId: string;
}): Promise<CurrentChannelRow | null> {
  const rows = await db.channel.findMany({
    where: {
      tenantId: input.tenantId,
      ownerClawscaleUserId: input.clawscaleUserId,
      type: PERSONAL_CHANNEL_TYPE,
      scope: PERSONAL_CHANNEL_SCOPE,
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      scope: true,
      ownerClawscaleUserId: true,
      status: true,
      updatedAt: true,
    },
  });

  if (rows.length === 0) {
    return null;
  }

  rows.forEach(assertValidPersonalChannelRow);
  const firstRow = rows[0];
  if (!firstRow) {
    return null;
  }

  const activeRows = rows.filter((row) => row.status !== 'archived');
  if (activeRows.length > 1) {
    throw new Error('duplicate_personal_channel_rows');
  }

  return activeRows[0] ?? firstRow;
}

export function createPersonalWechatChannelRouter(
  options: PersonalWechatChannelRouterOptions,
) {
  return new Hono()
    .use('*', options.authMiddleware)

    .post('/', async (c) => {
      try {
        const auth = await options.resolveAuth(c, 'create');
        const channel = await createOrReusePersonalWeChatChannel({
          tenantId: auth.tenantId,
          clawscaleUserId: auth.clawscaleUserId,
        });

        return c.json({
          ok: true,
          data: {
            ...buildLifecyclePayload(channel.id, channel.status as LifecycleStatus, null),
          },
        });
      } catch (err) {
        const response = respondLifecycleError(c, err);
        if (response) {
          return response;
        }

        throw err;
      }
    })

    .post('/connect', async (c) => {
      try {
        const auth = await options.resolveAuth(c, 'connect');
        const channel = await createOrReusePersonalWeChatChannel({
          tenantId: auth.tenantId,
          clawscaleUserId: auth.clawscaleUserId,
        });

        const liveStatus = getWeixinStatus(channel.id);
        const restoreState = getWeixinRestoreState();
        const status = resolveStatus(channel.status, liveStatus, restoreState);

        if (status === 'connected') {
          return c.json({
            ok: true,
            data: buildLifecyclePayload(channel.id, status, null),
          });
        }

        const shouldRestart = channel.status !== 'pending' || liveStatus !== 'qr_pending';

        if (shouldRestart) {
          if (liveStatus && liveStatus !== 'connected') {
            await stopWeixinBot(channel.id);
          }

          await db.channel.update({
            where: { id: channel.id },
            data: { status: 'pending' },
          });

          await startWeixinQR(channel.id);
        }

        const qr = await waitForWeixinQR(channel.id);
        const latestLiveStatus = getWeixinStatus(channel.id);
        const latestStatus = resolveStatus(
          channel.status,
          latestLiveStatus,
          getWeixinRestoreState(),
        );

        return c.json({
          ok: true,
          data: buildLifecyclePayload(
            channel.id,
            latestStatus,
            latestStatus === 'pending' ? qr : null,
          ),
        });
      } catch (err) {
        const response = respondLifecycleError(c, err);
        if (response) {
          return response;
        }

        throw err;
      }
    })

    .get('/status', async (c) => {
      try {
        const auth = await options.resolveAuth(c, 'status');
        const channel = await loadCurrentPersonalChannel({
          tenantId: auth.tenantId,
          clawscaleUserId: auth.clawscaleUserId,
        });

        if (!channel) {
          return c.json({
            ok: true,
            data: buildLifecyclePayload(null, 'missing', null),
          });
        }

        const liveStatus = getWeixinStatus(channel.id);
        const status = resolveStatus(channel.status, liveStatus, getWeixinRestoreState());
        const qr = status === 'pending' ? await waitForWeixinQR(channel.id) : null;
        const latestLiveStatus = getWeixinStatus(channel.id);
        const latestStatus = resolveStatus(
          channel.status,
          latestLiveStatus,
          getWeixinRestoreState(),
        );

        return c.json({
          ok: true,
          data: buildLifecyclePayload(
            channel.id,
            latestStatus,
            latestStatus === 'pending' ? qr : null,
          ),
        });
      } catch (err) {
        const response = respondLifecycleError(c, err);
        if (response) {
          return response;
        }

        throw err;
      }
    })

    .post('/disconnect', async (c) => {
      try {
        const auth = await options.resolveAuth(c, 'disconnect');
        const channel = await disconnectPersonalWeChatChannel({
          tenantId: auth.tenantId,
          clawscaleUserId: auth.clawscaleUserId,
        });

        await stopWeixinBot(channel.id);

        return c.json({
          ok: true,
          data: buildLifecyclePayload(channel.id, 'disconnected', null),
        });
      } catch (err) {
        const response = respondLifecycleError(c, err);
        if (response) {
          return response;
        }

        throw err;
      }
    })

    .delete('/', async (c) => {
      try {
        const auth = await options.resolveAuth(c, 'delete');
        const current = await loadCurrentPersonalChannel({
          tenantId: auth.tenantId,
          clawscaleUserId: auth.clawscaleUserId,
        });

        if (!current) {
          return c.json({ ok: false, error: 'personal_channel_not_found' }, 404);
        }

        const liveStatus = getWeixinStatus(current.id);
        const resolvedStatus = resolveStatus(current.status, liveStatus, getWeixinRestoreState());

        if (resolvedStatus === 'archived') {
          return c.json({
            ok: true,
            data: buildLifecyclePayload(current.id, 'archived', null),
          });
        }

        if (resolvedStatus === 'pending' || resolvedStatus === 'connected') {
          return c.json({ ok: false, error: 'disconnect_before_archive' }, 409);
        }

        await stopWeixinBot(current.id);

        const archived = await archivePersonalWeChatChannel({
          tenantId: auth.tenantId,
          clawscaleUserId: auth.clawscaleUserId,
        });

        return c.json({
          ok: true,
          data: buildLifecyclePayload(archived.id, 'archived', null),
        });
      } catch (err) {
        const response = respondLifecycleError(c, err);
        if (response) {
          return response;
        }

        throw err;
      }
    });
}

export const userWechatChannelRouter = createPersonalWechatChannelRouter({
  authMiddleware: requireUserWechatChannelAuth,
  resolveAuth: readBridgeAuth,
});
