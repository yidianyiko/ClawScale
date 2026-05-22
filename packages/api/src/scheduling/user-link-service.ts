import { createHash, randomBytes } from 'node:crypto';

const USER_LINK_CODE_BYTES = 9;
const LINK_SESSION_TOKEN_BYTES = 32;
const LINK_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface UserLinkRecord {
  id: string;
  code: string;
  status: 'active' | 'disabled';
  providerAccountId: string;
}

interface ProviderProfileRecord {
  id: string;
  displayName: string;
  tagline: string | null;
  avatarUrl: string | null;
}

interface UserLinkClient {
  userLink: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<UserLinkRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<UserLinkRecord>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  linkSession: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findUnique(args: {
      where: { tokenHash: string };
      select?: Record<string, unknown>;
    }): Promise<LinkSessionRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  customer: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<ProviderProfileRecord | null>;
  };
  friendRequest: {
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  accountBlock: {
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  };
  productNotification: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  $transaction?<T>(fn: (client: UserLinkTransactionClient) => Promise<T>): Promise<T>;
}

type UserLinkWriteClient = Pick<UserLinkClient, 'userLink'>;
type UserLinkTransactionClient = Pick<UserLinkClient, 'userLink' | 'linkSession'>;

interface UserLinkInput {
  providerAccountId: string;
}

interface CreateLinkSessionInput {
  code: string;
}

interface LinkSessionRecord {
  id: string;
  providerAccountId: string;
  consumerAccountId: string | null;
  status: 'opened' | 'claimed' | 'abandoned';
  expiresAt: Date;
}

export interface PublicUserLinkResult {
  code: string;
  status: 'active';
  url: string;
  qrUrl: string;
  profile: {
    displayName: string;
    tagline: string | null;
    avatarUrl: string | null;
  };
}

function readDomainClient(): string {
  const value = process.env['DOMAIN_CLIENT']?.trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error('DOMAIN_CLIENT is required');
  }
  return value;
}

function nonEmpty(value: string, code = 'invalid_input'): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(code);
  }
  return trimmed;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function newUserLinkCode(): string {
  return randomBytes(USER_LINK_CODE_BYTES).toString('base64url');
}

function newSessionToken(): string {
  return randomBytes(LINK_SESSION_TOKEN_BYTES).toString('base64url');
}

function tokenHash(token: string): string {
  return sha256Hex(nonEmpty(token, 'invalid_link_session'));
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function userLinkUrl(code: string): string {
  return `${readDomainClient()}/u/${encodeURIComponent(code)}`;
}

function userLinkQrUrl(code: string): string {
  return `${userLinkUrl(code)}/qr`;
}

function authUrl(path: '/auth/login' | '/auth/register', code: string, token: string): string {
  const next = `/u/${encodeURIComponent(code)}?link_session=${encodeURIComponent(token)}`;
  return `${readDomainClient()}${path}?next=${encodeURIComponent(next)}`;
}

async function readProviderProfile(
  client: Pick<UserLinkClient, 'customer'>,
  providerAccountId: string,
): Promise<PublicUserLinkResult['profile']> {
  const customer = await client.customer.findUnique({
    where: { id: providerAccountId },
    select: { id: true, displayName: true, tagline: true, avatarUrl: true },
  });
  if (!customer) {
    throw new Error('provider_not_found');
  }
  return {
    displayName: customer.displayName,
    tagline: customer.tagline,
    avatarUrl: customer.avatarUrl,
  };
}

function publicResult(
  link: UserLinkRecord,
  profile: PublicUserLinkResult['profile'],
): PublicUserLinkResult {
  return {
    code: link.code,
    status: 'active',
    url: userLinkUrl(link.code),
    qrUrl: userLinkQrUrl(link.code),
    profile,
  };
}

async function createActiveUserLink(
  client: UserLinkWriteClient,
  providerAccountId: string,
): Promise<UserLinkRecord> {
  return client.userLink.create({
    data: {
      providerAccountId,
      code: newUserLinkCode(),
      status: 'active',
    },
  });
}

async function findActiveUserLink(
  client: UserLinkWriteClient,
  providerAccountId: string,
): Promise<UserLinkRecord | null> {
  return client.userLink.findFirst({
    where: { providerAccountId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
}

async function createActiveUserLinkWithConflictRead(
  client: UserLinkWriteClient,
  providerAccountId: string,
): Promise<UserLinkRecord> {
  try {
    return await createActiveUserLink(client, providerAccountId);
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    const racedLink = await findActiveUserLink(client, providerAccountId);
    if (!racedLink) {
      throw error;
    }
    return racedLink;
  }
}

async function runUserLinkWrite<T>(
  client: UserLinkClient,
  fn: (writeClient: UserLinkWriteClient) => Promise<T>,
): Promise<T> {
  if (client.$transaction) {
    return client.$transaction(fn);
  }
  return fn(client);
}

export async function getOrCreateActiveUserLink(
  client: UserLinkClient,
  input: UserLinkInput,
): Promise<PublicUserLinkResult> {
  const providerAccountId = nonEmpty(input.providerAccountId, 'invalid_provider_account');
  const existing = await findActiveUserLink(client, providerAccountId);
  const link = existing ?? (await createActiveUserLinkWithConflictRead(client, providerAccountId));
  const profile = await readProviderProfile(client, providerAccountId);
  return publicResult(link, profile);
}

export async function readPublicUserLinkByCode(
  client: UserLinkClient,
  input: { code: string },
): Promise<PublicUserLinkResult | null> {
  const code = nonEmpty(input.code, 'invalid_user_link');
  const link = await client.userLink.findFirst({
    where: { code, status: 'active' },
  });
  if (!link) return null;
  const profile = await readProviderProfile(client, link.providerAccountId);
  return publicResult(link, profile);
}

export async function resetUserLink(
  client: UserLinkClient,
  input: UserLinkInput,
): Promise<PublicUserLinkResult> {
  const providerAccountId = nonEmpty(input.providerAccountId, 'invalid_provider_account');
  let link: UserLinkRecord;
  try {
    link = await runUserLinkWrite(client, async (writeClient) => {
      await writeClient.userLink.updateMany({
        where: { providerAccountId, status: 'active' },
        data: { status: 'disabled', disabledAt: new Date() },
      });
      return createActiveUserLink(writeClient, providerAccountId);
    });
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    const racedLink = await findActiveUserLink(client, providerAccountId);
    if (!racedLink) {
      throw error;
    }
    link = racedLink;
  }
  const profile = await readProviderProfile(client, providerAccountId);
  return publicResult(link, profile);
}

export async function disableUserLink(
  client: Pick<UserLinkClient, 'userLink'>,
  input: UserLinkInput,
): Promise<{ count: number }> {
  const providerAccountId = nonEmpty(input.providerAccountId, 'invalid_provider_account');
  return client.userLink.updateMany({
    where: { providerAccountId, status: 'active' },
    data: { status: 'disabled', disabledAt: new Date() },
  });
}

export async function createLinkSession(
  client: Pick<UserLinkClient, 'userLink' | 'linkSession'>,
  input: CreateLinkSessionInput,
): Promise<{
  token: string;
  nextUrl: string;
  registerUrl: string;
  expiresAt: Date;
}> {
  const code = nonEmpty(input.code, 'invalid_user_link');
  const userLink = await client.userLink.findFirst({
    where: { code, status: 'active' },
  });
  if (!userLink) {
    throw new Error('user_link_not_found');
  }

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + LINK_SESSION_TTL_MS);
  await client.linkSession.create({
    data: {
      tokenHash: tokenHash(token),
      userLinkId: userLink.id,
      providerAccountId: userLink.providerAccountId,
      status: 'opened',
      expiresAt,
    },
  });

  return {
    token,
    nextUrl: authUrl('/auth/login', userLink.code, token),
    registerUrl: authUrl('/auth/register', userLink.code, token),
    expiresAt,
  };
}

export async function getLinkSessionStatus(
  client: Pick<UserLinkClient, 'linkSession'>,
  input: { token: string },
): Promise<LinkSessionRecord> {
  const session = await client.linkSession.findUnique({
    where: { tokenHash: tokenHash(input.token) },
    select: {
      id: true,
      providerAccountId: true,
      consumerAccountId: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!session) {
    throw new Error('link_session_not_found');
  }
  return session;
}

export async function claimLinkSession(
  _client: unknown,
  _input: { token: string; consumerAccountId: string },
): Promise<LinkSessionRecord> {
  throw new Error('appointment_scheduling_retired');
}

export async function sendFriendRequestFromLinkSession(
  client: UserLinkClient,
  input: {
    token: string;
    requesterAccountId: string;
    message: string | null;
    idempotencyKey: string;
  },
): Promise<Record<string, unknown>> {
  const requesterAccountId = nonEmpty(input.requesterAccountId, 'invalid_account');
  const session = await client.linkSession.findUnique({
    where: { tokenHash: tokenHash(input.token) },
  });
  if (!session || session.status !== 'opened') {
    throw new Error('invalid_link_session');
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new Error('link_session_expired');
  }
  if (session.providerAccountId === requesterAccountId) {
    throw new Error('cannot_friend_self');
  }

  const block = await client.accountBlock.findFirst({
    where: {
      blockerAccountId: session.providerAccountId,
      blockedAccountId: requesterAccountId,
    },
  });
  if (block) {
    throw new Error('friend_request_blocked');
  }

  const existing = await client.friendRequest.findFirst({
    where: {
      requesterAccountId,
      targetAccountId: session.providerAccountId,
      status: 'pending',
    },
  });
  if (existing) {
    return existing;
  }

  const request = await client.friendRequest.create({
    data: {
      requesterAccountId,
      targetAccountId: session.providerAccountId,
      linkSessionId: session.id,
      message: input.message,
      idempotencyKey: input.idempotencyKey,
      status: 'pending',
    },
  });
  await client.linkSession.updateMany({
    where: { id: session.id, status: 'opened' },
    data: {
      status: 'claimed',
      consumerAccountId: requesterAccountId,
      claimedAt: new Date(),
    },
  });
  await client.productNotification.create({
    data: {
      friendRequestId: request['id'],
      recipientAccountId: session.providerAccountId,
      idempotencyKey: `friend-request:${request['id']}:target`,
      kind: 'friend_request',
      payload: {
        text: '你有一个新的好友请求，请确认或拒绝。',
        metadata: {
          request_id: request['id'],
          request_type: 'friend_request',
          actor_account_id: requesterAccountId,
          allowed_actions: ['accept', 'reject'],
        },
      },
      status: 'pending_delivery',
    },
  });
  return request;
}
