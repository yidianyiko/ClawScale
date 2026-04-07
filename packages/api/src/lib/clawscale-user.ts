import { db } from '../db/index.js';
import { generateId } from './id.js';

export type ClawscaleUserBindingErrorCode = 'end_user_not_found' | 'end_user_already_bound';

export class ClawscaleUserBindingError extends Error {
  constructor(
    public readonly code: ClawscaleUserBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClawscaleUserBindingError';
  }
}

export interface BindEndUserToCokeAccountInput {
  tenantId: string;
  channelId: string;
  externalId: string;
  cokeAccountId: string;
}

export interface BindEndUserToCokeAccountResult {
  clawscaleUserId: string;
  endUserId: string;
  cokeAccountId: string;
}

export interface UnifiedConversationIdsInput {
  tenantId: string;
  endUserId: string;
  clawscaleUserId: string | null;
  linkedTo: string | null;
}

export async function bindEndUserToCokeAccount(
  input: BindEndUserToCokeAccountInput,
): Promise<BindEndUserToCokeAccountResult> {
  const endUser = await db.endUser.findUnique({
    where: {
      tenantId_channelId_externalId: {
        tenantId: input.tenantId,
        channelId: input.channelId,
        externalId: input.externalId,
      },
    },
    select: {
      id: true,
      clawscaleUserId: true,
    },
  });

  if (!endUser) {
    throw new ClawscaleUserBindingError('end_user_not_found', 'End user not found');
  }

  const requestedClawscaleUser = await db.clawscaleUser.findUnique({
    where: {
      tenantId_cokeAccountId: {
        tenantId: input.tenantId,
        cokeAccountId: input.cokeAccountId,
      },
    },
    select: {
      id: true,
    },
  });

  if (endUser.clawscaleUserId && requestedClawscaleUser?.id !== endUser.clawscaleUserId) {
    throw new ClawscaleUserBindingError('end_user_already_bound', 'End user is already bound to another ClawscaleUser');
  }

  const clawscaleUser = await db.$transaction(async (tx) => {
    const user = await tx.clawscaleUser.upsert({
      where: {
        tenantId_cokeAccountId: {
          tenantId: input.tenantId,
          cokeAccountId: input.cokeAccountId,
        },
      },
      create: {
        id: generateId('csu'),
        tenantId: input.tenantId,
        cokeAccountId: input.cokeAccountId,
      },
      update: {},
      select: {
        id: true,
      },
    });

    await tx.endUser.update({
      where: { id: endUser.id },
      data: { clawscaleUserId: user.id },
    });

    return user;
  });

  return {
    clawscaleUserId: clawscaleUser.id,
    endUserId: endUser.id,
    cokeAccountId: input.cokeAccountId,
  };
}

export async function getUnifiedConversationIds(
  input: UnifiedConversationIdsInput,
): Promise<string[]> {
  if (input.clawscaleUserId) {
    const unifiedEndUsers = await db.endUser.findMany({
      where: {
        tenantId: input.tenantId,
        clawscaleUserId: input.clawscaleUserId,
      },
      select: { id: true },
    });

    const conversations = await db.conversation.findMany({
      where: {
        endUserId: {
          in: unifiedEndUsers.map((endUser) => endUser.id),
        },
      },
      select: { id: true },
    });

    return conversations.map((conversation) => conversation.id);
  }

  const primaryId = input.linkedTo ?? input.endUserId;
  const linkedUsers = await db.endUser.findMany({
    where: {
      tenantId: input.tenantId,
      OR: [
        { id: primaryId },
        { linkedTo: primaryId },
      ],
    },
    select: { id: true },
  });

  const conversations = await db.conversation.findMany({
    where: {
      endUserId: {
        in: linkedUsers.map((endUser) => endUser.id),
      },
    },
    select: { id: true },
  });

  return conversations.map((conversation) => conversation.id);
}
