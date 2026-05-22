import { createHash, randomBytes } from 'node:crypto';
import { enqueueProductNotification } from './notification-service.js';

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
    findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<ProductNotificationDeliveryRecord[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  $transaction?<T>(fn: (client: UserLinkTransactionClient) => Promise<T>): Promise<T>;
}

type UserLinkWriteClient = Pick<UserLinkClient, 'userLink'>;
type FriendRequestWriteClient = Pick<
  UserLinkClient,
  'linkSession' | 'friendRequest' | 'accountBlock' | 'productNotification'
>;
type UserLinkTransactionClient = Pick<
  UserLinkClient,
  'userLink' | 'linkSession' | 'friendRequest' | 'accountBlock' | 'productNotification'
>;

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

interface ProductNotificationDeliveryRecord {
  id: string;
  recipientAccountId: string;
  idempotencyKey: string;
  kind: string;
  payload: unknown;
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

async function runFriendRequestWrite<T>(
  client: UserLinkClient,
  fn: (writeClient: FriendRequestWriteClient) => Promise<T>,
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
  targetAccountId: string;
  loginUrl: string;
  registerUrl: string;
  expiresAt: string;
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
    targetAccountId: userLink.providerAccountId,
    loginUrl: authUrl('/auth/login', userLink.code, token),
    registerUrl: authUrl('/auth/register', userLink.code, token),
    expiresAt: expiresAt.toISOString(),
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
  const sessionTokenHash = tokenHash(input.token);

  return runFriendRequestWrite(client, async (writeClient) => {
    const session = await writeClient.linkSession.findUnique({
      where: { tokenHash: sessionTokenHash },
    });
    if (!session) {
      throw new Error('invalid_link_session');
    }
    if (session.providerAccountId === requesterAccountId) {
      throw new Error('cannot_friend_self');
    }

    if (session.status === 'claimed') {
      if (session.consumerAccountId !== requesterAccountId) {
        throw new Error('invalid_link_session');
      }
      const existing = await findPendingFriendRequest(
        writeClient,
        requesterAccountId,
        session.providerAccountId,
      );
      if (!existing) {
        throw new Error('invalid_link_session');
      }
      await ensureFriendRequestNotification(writeClient, {
        request: existing,
        requesterAccountId,
        targetAccountId: session.providerAccountId,
      });
      return existing;
    }
    if (session.status !== 'opened') {
      throw new Error('invalid_link_session');
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new Error('link_session_expired');
    }
    const block = await writeClient.accountBlock.findFirst({
      where: {
        blockerAccountId: session.providerAccountId,
        blockedAccountId: requesterAccountId,
      },
    });
    if (block) {
      throw new Error('friend_request_blocked');
    }

    const existing = await findPendingFriendRequest(
      writeClient,
      requesterAccountId,
      session.providerAccountId,
    );
    const claim = await writeClient.linkSession.updateMany({
      where: { id: session.id, status: 'opened' },
      data: {
        status: 'claimed',
        consumerAccountId: requesterAccountId,
        claimedAt: new Date(),
      },
    });
    if (claim.count !== 1) {
      const raced = await findPendingFriendRequest(
        writeClient,
        requesterAccountId,
        session.providerAccountId,
      );
      if (raced) {
        return raced;
      }
      throw new Error('invalid_link_session');
    }

    const request = existing ?? (await createFriendRequestWithConflictRead(writeClient, {
      requesterAccountId,
      targetAccountId: session.providerAccountId,
      linkSessionId: session.id,
      message: input.message,
      idempotencyKey: input.idempotencyKey,
    }));
    await ensureFriendRequestNotification(writeClient, {
      request,
      requesterAccountId,
      targetAccountId: session.providerAccountId,
    });
    return request;
  });
}

async function findPendingFriendRequest(
  client: Pick<UserLinkClient, 'friendRequest'>,
  requesterAccountId: string,
  targetAccountId: string,
): Promise<Record<string, unknown> | null> {
  return client.friendRequest.findFirst({
    where: {
      requesterAccountId,
      targetAccountId,
      status: 'pending',
    },
  });
}

async function createFriendRequestWithConflictRead(
  client: Pick<UserLinkClient, 'friendRequest'>,
  input: {
    requesterAccountId: string;
    targetAccountId: string;
    linkSessionId: string;
    message: string | null;
    idempotencyKey: string;
  },
): Promise<Record<string, unknown>> {
  try {
    return await client.friendRequest.create({
      data: {
        requesterAccountId: input.requesterAccountId,
        targetAccountId: input.targetAccountId,
        linkSessionId: input.linkSessionId,
        message: input.message,
        idempotencyKey: input.idempotencyKey,
        status: 'pending',
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    const existing = await findPendingFriendRequest(
      client,
      input.requesterAccountId,
      input.targetAccountId,
    );
    if (!existing) {
      throw error;
    }
    return existing;
  }
}

async function ensureFriendRequestNotification(
  client: Pick<UserLinkClient, 'productNotification'>,
  input: {
    request: Record<string, unknown>;
    requesterAccountId: string;
    targetAccountId: string;
  },
): Promise<void> {
  const requestId = nonEmpty(String(input.request['id'] ?? ''), 'friend_request_not_found');
  const idempotencyKey = `friend-request:${requestId}:target`;
  const existing = await client.productNotification.findFirst({
    where: { idempotencyKey },
  });
  if (existing) {
    return;
  }

  await enqueueProductNotification(client, {
    requestId,
    requestType: 'friend_request',
    recipientAccountId: input.targetAccountId,
    idempotencyKey,
    kind: 'friend_request',
    text: '你有一个新的好友请求，请确认或拒绝。',
    metadata: {
      request_id: requestId,
      request_type: 'friend_request',
      actor_account_id: input.requesterAccountId,
      allowed_actions: ['accept', 'reject'],
    },
  });
}
