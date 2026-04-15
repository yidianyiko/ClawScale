import { db } from '../db/index.js';
import { getWeixinRestoreState, getWeixinStatus } from '../adapters/wechat.js';
import { generateId } from './id.js';

const PERSONAL_CHANNEL_TYPE = 'wechat_personal' as const;
const PERSONAL_CHANNEL_SCOPE = 'personal' as const;

type PersonalWeChatChannelInput = {
  tenantId: string;
  clawscaleUserId: string;
};

type PersonalWeChatChannelRow = {
  id: string;
  tenantId: string;
  type: string;
  scope?: string | null;
  ownerClawscaleUserId?: string | null;
  status: string;
};

function activeLifecycleKey(input: PersonalWeChatChannelInput): string {
  return `${input.tenantId}:${input.clawscaleUserId}:${PERSONAL_CHANNEL_TYPE}`;
}

async function resolveClawscaleUser(input: PersonalWeChatChannelInput) {
  const user = await db.clawscaleUser.findUnique({
    where: { id: input.clawscaleUserId },
    select: { id: true, tenantId: true, cokeAccountId: true },
  });

  if (!user || user.tenantId !== input.tenantId) {
    throw new Error('clawscale_user_not_found');
  }

  return user;
}

function isActiveLifecycleKeyConflict(error: unknown): boolean {
  const prismaError = error as {
    code?: string;
    meta?: { target?: unknown };
  };

  if (prismaError.code !== 'P2002') {
    return false;
  }

  const target = prismaError.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('activeLifecycleKey');
  }

  if (typeof target === 'string') {
    return target === 'activeLifecycleKey';
  }

  return false;
}

function assertValidPersonalWeChatChannelRow(row: PersonalWeChatChannelRow | null | undefined) {
  if (!row) {
    return;
  }

  if (row.type !== PERSONAL_CHANNEL_TYPE) {
    throw new Error('invalid_personal_channel_row');
  }

  if (row.scope === PERSONAL_CHANNEL_SCOPE && !row.ownerClawscaleUserId) {
    throw new Error('invalid_personal_channel_row');
  }

  if (row.scope === 'tenant_shared' && row.ownerClawscaleUserId) {
    throw new Error('invalid_personal_channel_row');
  }

  if (row.scope !== PERSONAL_CHANNEL_SCOPE) {
    throw new Error('invalid_personal_channel_row');
  }

  if (!row.ownerClawscaleUserId) {
    throw new Error('invalid_personal_channel_row');
  }
}

function resolveArchiveStatus(
  rowStatus: string,
  liveStatus: ReturnType<typeof getWeixinStatus>,
  restoreState: ReturnType<typeof getWeixinRestoreState>,
) {
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

async function findActivePersonalWeChatChannel(input: PersonalWeChatChannelInput) {
  const channels = await db.channel.findMany({
    where: {
      tenantId: input.tenantId,
      ownerClawscaleUserId: input.clawscaleUserId,
      type: PERSONAL_CHANNEL_TYPE,
      scope: PERSONAL_CHANNEL_SCOPE,
      NOT: { status: 'archived' },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });

  if (channels.length === 0) {
    return null;
  }

  channels.forEach(assertValidPersonalWeChatChannelRow);

  if (channels.length > 1) {
    throw new Error('duplicate_personal_channel_rows');
  }

  return channels[0];
}

export async function createOrReusePersonalWeChatChannel(
  input: PersonalWeChatChannelInput,
) {
  const user = await resolveClawscaleUser(input);

  const existing = await findActivePersonalWeChatChannel(input);
  if (existing) {
    return existing;
  }

  try {
    return await db.channel.create({
      data: {
        id: generateId('ch'),
        tenantId: input.tenantId,
        type: PERSONAL_CHANNEL_TYPE,
        scope: PERSONAL_CHANNEL_SCOPE,
        ownerClawscaleUserId: input.clawscaleUserId,
        activeLifecycleKey: activeLifecycleKey(input),
        name: 'My WeChat',
        status: 'disconnected',
        config: {},
        ownershipKind: 'customer',
        customerId: user.cokeAccountId,
        agentId: null,
      },
    });
  } catch (error) {
    if (!isActiveLifecycleKeyConflict(error)) {
      throw error;
    }

    const raced = await findActivePersonalWeChatChannel(input);
    if (raced) {
      return raced;
    }

    throw error;
  }
}

export async function disconnectPersonalWeChatChannel(
  input: PersonalWeChatChannelInput,
) {
  await resolveClawscaleUser(input);

  const channel = await findActivePersonalWeChatChannel(input);
  if (!channel) {
    throw new Error('personal_channel_not_found');
  }

  return db.channel.update({
    where: { id: channel.id },
    data: { status: 'disconnected', config: {} },
  });
}

export async function archivePersonalWeChatChannel(
  input: PersonalWeChatChannelInput,
) {
  await resolveClawscaleUser(input);

  const channel = await findActivePersonalWeChatChannel(input);
  if (!channel) {
    throw new Error('personal_channel_not_found');
  }

  const resolvedStatus = resolveArchiveStatus(
    channel.status,
    getWeixinStatus(channel.id),
    getWeixinRestoreState(),
  );

  if (resolvedStatus === 'pending' || resolvedStatus === 'connected') {
    throw new Error('disconnect_before_archive');
  }

  return db.channel.update({
    where: { id: channel.id },
    data: {
      status: 'archived',
      config: {},
      activeLifecycleKey: null,
    },
  });
}
