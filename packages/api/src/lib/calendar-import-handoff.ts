import { createHash, randomBytes } from 'node:crypto';

export const CALENDAR_IMPORT_HANDOFF_TTL_MS = 15 * 60 * 1000;

export type CalendarImportHandoffStatus = 'pending' | 'claimed' | 'consumed';

export interface CalendarImportHandoffSession {
  id: string;
  tokenHash: string;
  status: CalendarImportHandoffStatus;
  sourceCustomerId: string;
  targetCustomerId?: string | null;
  targetIdentityId?: string | null;
  provider: string;
  identityType: string;
  identityValue: string;
  tenantId: string;
  channelId: string;
  endUserId: string;
  externalId: string;
  gatewayConversationId: string;
  businessConversationKey: string;
  targetConversationId?: string | null;
  targetCharacterId?: string | null;
  expiresAt: Date;
  claimedAt?: Date | null;
  consumedAt?: Date | null;
}

export interface CreateCalendarImportHandoffInput {
  sourceCustomerId: string;
  tenantId: string;
  channelId: string;
  endUserId: string;
  externalId: string;
  gatewayConversationId: string;
  businessConversationKey: string;
}

export interface ClaimCalendarImportHandoffInput {
  token: string;
  customerId: string;
  identityId: string;
}

export interface ResolveClaimedCalendarImportHandoffInput extends ClaimCalendarImportHandoffInput {}

export interface ConsumeCalendarImportHandoffInput extends ClaimCalendarImportHandoffInput {
  targetConversationId: string;
  targetCharacterId: string;
}

export type CalendarImportHandoffErrorCode =
  | 'invalid_handoff'
  | 'expired_handoff'
  | 'handoff_already_consumed'
  | 'account_not_active'
  | 'identity_already_bound';

export class CalendarImportHandoffError extends Error {
  constructor(public readonly code: CalendarImportHandoffErrorCode) {
    super(code);
    this.name = 'CalendarImportHandoffError';
  }
}

interface CalendarImportHandoffClient {
  calendarImportHandoffSession: {
    create(args: { data: Record<string, unknown> }): Promise<CalendarImportHandoffSession>;
    findUnique(args: { where: { tokenHash: string } }): Promise<CalendarImportHandoffSession | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<CalendarImportHandoffSession>;
  };
  membership: {
    findFirst(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<{
      customerId: string;
      identityId: string;
      identity: { claimStatus: 'active' | 'pending' | 'unclaimed' };
    } | null>;
  };
  externalIdentity: {
    findUnique(args: {
      where: {
        provider_identityType_identityValue: {
          provider: string;
          identityType: string;
          identityValue: string;
        };
      };
      select?: Record<string, unknown>;
    }): Promise<{ id: string; customerId: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; customerId: string }>;
    update(args: {
      where: { id: string };
      data: { customerId: string };
    }): Promise<{ id: string; customerId: string }>;
  };
  $transaction?<T>(fn: (client: CalendarImportHandoffClient) => Promise<T>): Promise<T>;
}

function readDomainClient(): string {
  const value = process.env['DOMAIN_CLIENT']?.trim().replace(/\/$/, '');
  if (!value) {
    throw new Error('DOMAIN_CLIENT is required');
  }
  return value;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function nonEmpty(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CalendarImportHandoffError('invalid_handoff');
  }
  return trimmed;
}

function tokenHash(token: string): string {
  return sha256Hex(nonEmpty(token));
}

export async function createCalendarImportHandoff(
  client: Pick<CalendarImportHandoffClient, 'calendarImportHandoffSession'>,
  input: CreateCalendarImportHandoffInput,
): Promise<{ token: string; url: string; session: CalendarImportHandoffSession }> {
  const token = newToken();
  const session = await client.calendarImportHandoffSession.create({
    data: {
      tokenHash: tokenHash(token),
      status: 'pending',
      sourceCustomerId: nonEmpty(input.sourceCustomerId),
      provider: 'whatsapp_evolution',
      identityType: 'wa_id',
      identityValue: nonEmpty(input.externalId),
      tenantId: nonEmpty(input.tenantId),
      channelId: nonEmpty(input.channelId),
      endUserId: nonEmpty(input.endUserId),
      externalId: nonEmpty(input.externalId),
      gatewayConversationId: nonEmpty(input.gatewayConversationId),
      businessConversationKey: nonEmpty(input.businessConversationKey),
      expiresAt: new Date(Date.now() + CALENDAR_IMPORT_HANDOFF_TTL_MS),
    },
  });

  return {
    token,
    url: `${readDomainClient()}/handoff/calendar-import?token=${encodeURIComponent(token)}`,
    session,
  };
}

async function findActiveOwner(
  client: CalendarImportHandoffClient,
  input: { customerId: string; identityId?: string },
) {
  return client.membership.findFirst({
    where: {
      customerId: input.customerId,
      ...(input.identityId ? { identityId: input.identityId } : {}),
      role: 'owner',
    },
    include: {
      identity: {
        select: {
          claimStatus: true,
        },
      },
    },
  });
}

async function claimCalendarImportHandoffInTransaction(
  client: CalendarImportHandoffClient,
  input: ClaimCalendarImportHandoffInput,
): Promise<{ session: CalendarImportHandoffSession }> {
  const session = await client.calendarImportHandoffSession.findUnique({
    where: { tokenHash: tokenHash(input.token) },
  });
  if (!session) {
    throw new CalendarImportHandoffError('invalid_handoff');
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new CalendarImportHandoffError('expired_handoff');
  }
  if (session.status === 'consumed') {
    throw new CalendarImportHandoffError('handoff_already_consumed');
  }

  const owner = await findActiveOwner(client, {
    customerId: input.customerId,
    identityId: input.identityId,
  });
  if (!owner || owner.identity.claimStatus !== 'active') {
    throw new CalendarImportHandoffError('account_not_active');
  }

  const externalIdentityWhere = {
    provider_identityType_identityValue: {
      provider: session.provider,
      identityType: session.identityType,
      identityValue: session.identityValue,
    },
  };
  const externalIdentity = await client.externalIdentity.findUnique({
    where: externalIdentityWhere,
    select: {
      id: true,
      customerId: true,
    },
  });

  if (!externalIdentity) {
    await client.externalIdentity.create({
      data: {
        provider: session.provider,
        identityType: session.identityType,
        identityValue: session.identityValue,
        customerId: input.customerId,
        firstSeenChannelId: session.channelId,
      },
    });
  } else if (externalIdentity.customerId === session.sourceCustomerId) {
    await client.externalIdentity.update({
      where: { id: externalIdentity.id },
      data: { customerId: input.customerId },
    });
  } else if (externalIdentity.customerId !== input.customerId) {
    const conflictingOwner = await findActiveOwner(client, {
      customerId: externalIdentity.customerId,
    });
    if (conflictingOwner?.identity.claimStatus === 'active') {
      throw new CalendarImportHandoffError('identity_already_bound');
    }
    throw new CalendarImportHandoffError('identity_already_bound');
  }

  const claimed = await client.calendarImportHandoffSession.update({
    where: { id: session.id },
    data: {
      status: 'claimed',
      targetCustomerId: input.customerId,
      targetIdentityId: input.identityId,
      claimedAt: new Date(),
    },
  });
  return { session: claimed };
}

export async function claimCalendarImportHandoff(
  client: CalendarImportHandoffClient,
  input: ClaimCalendarImportHandoffInput,
): Promise<{ session: CalendarImportHandoffSession }> {
  if (client.$transaction) {
    return client.$transaction((tx) => claimCalendarImportHandoffInTransaction(tx, input));
  }
  return claimCalendarImportHandoffInTransaction(client, input);
}

function assertUsableClaimedSession(
  session: CalendarImportHandoffSession | null,
  input: ClaimCalendarImportHandoffInput,
): CalendarImportHandoffSession {
  if (!session) {
    throw new CalendarImportHandoffError('invalid_handoff');
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new CalendarImportHandoffError('expired_handoff');
  }
  if (session.status === 'consumed') {
    throw new CalendarImportHandoffError('handoff_already_consumed');
  }
  if (
    session.targetCustomerId !== input.customerId ||
    session.targetIdentityId !== input.identityId
  ) {
    throw new CalendarImportHandoffError('invalid_handoff');
  }
  return session;
}

export async function resolveClaimedCalendarImportHandoff(
  client: Pick<CalendarImportHandoffClient, 'calendarImportHandoffSession'>,
  input: ResolveClaimedCalendarImportHandoffInput,
): Promise<CalendarImportHandoffSession> {
  const session = await client.calendarImportHandoffSession.findUnique({
    where: { tokenHash: tokenHash(input.token) },
  });
  return assertUsableClaimedSession(session, input);
}

export async function consumeCalendarImportHandoff(
  client: Pick<CalendarImportHandoffClient, 'calendarImportHandoffSession'>,
  input: ConsumeCalendarImportHandoffInput,
): Promise<CalendarImportHandoffSession> {
  const session = await resolveClaimedCalendarImportHandoff(client, input);
  return client.calendarImportHandoffSession.update({
    where: { id: session.id },
    data: {
      status: 'consumed',
      targetConversationId: input.targetConversationId,
      targetCharacterId: input.targetCharacterId,
      consumedAt: new Date(),
    },
  });
}
