import { Prisma } from '@prisma/client';
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
  return db.$transaction(async (tx) => {
    const endUser = await tx.endUser.findUnique({
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

    const updated = await tx.endUser.updateMany({
      where: {
        id: endUser.id,
        tenantId: input.tenantId,
        OR: [
          { clawscaleUserId: null },
          { clawscaleUserId: user.id },
        ],
      },
      data: { clawscaleUserId: user.id },
    });

    if (updated.count !== 1) {
      throw new ClawscaleUserBindingError('end_user_already_bound', 'End user is already bound to another ClawscaleUser');
    }

    return {
      clawscaleUserId: user.id,
      endUserId: endUser.id,
      cokeAccountId: input.cokeAccountId,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
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
