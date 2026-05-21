import { createHash, randomBytes } from 'node:crypto';

const USER_LINK_CODE_BYTES = 9;
const LINK_SESSION_TOKEN_BYTES = 32;
const LINK_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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
  };
  customer: {
    findUnique(args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }): Promise<ProviderProfileRecord | null>;
  };
  $transaction?<T>(fn: (client: UserLinkWriteClient) => Promise<T>): Promise<T>;
}

type UserLinkWriteClient = Pick<UserLinkClient, 'userLink'>;

interface UserLinkInput {
  providerAccountId: string;
}

interface CreateLinkSessionInput {
  code: string;
}

export interface PublicUserLinkResult {
  id: string;
  code: string;
  status: 'active';
  url: string;
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
    id: link.id,
    code: link.code,
    status: 'active',
    url: userLinkUrl(link.code),
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
  const link = await runUserLinkWrite(client, async (writeClient) => {
    await writeClient.userLink.updateMany({
      where: { providerAccountId, status: 'active' },
      data: { status: 'disabled', disabledAt: new Date() },
    });
    return createActiveUserLink(writeClient, providerAccountId);
  });
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
  session: Record<string, unknown>;
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
  const session = await client.linkSession.create({
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
    session,
  };
}
