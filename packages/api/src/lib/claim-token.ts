import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  CustomerAuthError,
  type CustomerAuthResult,
  hashPassword,
  normalizeEmail,
  signCustomerToken,
} from './customer-auth.js';

const CLAIM_TOKEN_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '15m';

type ClaimOwnershipRecord = {
  role: 'owner' | 'member' | 'viewer';
  customer: {
    id: string;
  };
  identity: {
    id: string;
    email: string | null;
    claimStatus: 'active' | 'unclaimed' | 'pending';
    updatedAt?: Date;
  };
};

interface ClaimTokenPayload {
  sub: string;
  identityId: string;
  email: string;
  tokenType: 'action';
  purpose: 'claim';
  stateFingerprint?: string;
  iat?: number;
  exp?: number;
}

interface ClaimMembershipClient {
  membership: {
    findFirst(args: {
      where: {
        customerId: string;
        identityId: string;
        role: 'owner';
      };
      include: {
        customer: {
          select: {
            id: true;
          };
        };
        identity: {
          select: {
            claimStatus: true;
            email: true;
            id: true;
            updatedAt: true;
          };
        };
      };
    }): Promise<ClaimOwnershipRecord | null>;
  };
  $transaction<T>(fn: (client: {
    identity: {
      update(args: {
        where: { id: string };
        data: {
          email?: string;
          passwordHash?: string;
          claimStatus?: 'active' | 'pending';
        };
      }): Promise<{
        id: string;
        email?: string | null;
        claimStatus: 'active' | 'unclaimed' | 'pending';
        updatedAt?: Date;
      }>;
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{
        count: number;
      }>;
      findUnique(args: {
        where: { id: string };
        select: {
          updatedAt: true;
        };
      }): Promise<{
        updatedAt?: Date;
      } | null>;
    };
  }) => Promise<T>): Promise<T>;
}

export interface IssueClaimTokenInput {
  customerId: string;
  identityId: string;
  email: string;
}

export interface IssuedClaimToken {
  customerId: string;
  identityId: string;
  claimStatus: 'pending';
  email: string;
  token: string;
}

export interface CompleteCustomerClaimInput {
  token: string;
  password: string;
}

function readCustomerJwtSecret(): string {
  const secret =
    process.env['CUSTOMER_JWT_SECRET']?.trim() ?? process.env['COKE_JWT_SECRET']?.trim();

  if (!secret) {
    throw new Error('CUSTOMER_JWT_SECRET or COKE_JWT_SECRET is required');
  }

  return secret;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildStateFingerprint(updatedAt?: Date): string | undefined {
  if (!updatedAt) {
    return undefined;
  }

  return sha256Hex(updatedAt.toISOString());
}

function isUniqueConstraint(error: unknown, fieldName: string): boolean {
  const prismaError = error as {
    code?: string;
    meta?: { target?: unknown };
  };

  if (prismaError.code !== 'P2002') {
    return false;
  }

  const target = prismaError.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(fieldName);
  }

  return target === fieldName;
}

async function findClaimOwnership(
  client: Pick<ClaimMembershipClient, 'membership'>,
  input: { customerId: string; identityId: string },
): Promise<ClaimOwnershipRecord | null> {
  return client.membership.findFirst({
    where: {
      customerId: input.customerId,
      identityId: input.identityId,
      role: 'owner',
    },
    include: {
      customer: {
        select: {
          id: true,
        },
      },
      identity: {
        select: {
          claimStatus: true,
          email: true,
          id: true,
          updatedAt: true,
        },
      },
    },
  });
}

function issueSignedClaimToken(input: {
  customerId: string;
  identityId: string;
  email: string;
  updatedAt?: Date;
}): string {
  return jwt.sign(
    {
      sub: input.customerId,
      identityId: input.identityId,
      email: normalizeEmail(input.email),
      tokenType: 'action',
      purpose: 'claim',
      stateFingerprint: buildStateFingerprint(input.updatedAt),
    },
    readCustomerJwtSecret(),
    { expiresIn: CLAIM_TOKEN_EXPIRES_IN },
  );
}

function verifyClaimToken(token: string): ClaimTokenPayload {
  let payload: ClaimTokenPayload;
  try {
    payload = jwt.verify(token, readCustomerJwtSecret()) as ClaimTokenPayload;
  } catch {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  if (payload.tokenType !== 'action' || payload.purpose !== 'claim') {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  return payload;
}

function buildCustomerAuthResult(input: {
  customerId: string;
  identityId: string;
  email: string;
  membershipRole: 'owner' | 'member' | 'viewer';
}): CustomerAuthResult {
  return {
    customerId: input.customerId,
    identityId: input.identityId,
    claimStatus: 'active',
    email: input.email,
    membershipRole: input.membershipRole,
    token: signCustomerToken({
      customerId: input.customerId,
      identityId: input.identityId,
      email: input.email,
    }),
  };
}

export async function issueClaimToken(
  client: ClaimMembershipClient,
  input: IssueClaimTokenInput,
): Promise<IssuedClaimToken> {
  const email = normalizeEmail(input.email);
  const membership = await findClaimOwnership(client, input);

  if (!membership) {
    throw new CustomerAuthError('account_not_found');
  }

  if (membership.identity.claimStatus === 'active') {
    throw new CustomerAuthError('claim_not_allowed');
  }

  const updated = await client.$transaction(async (tx) => {
    const promoted = await tx.identity.updateMany({
      where: {
        id: membership.identity.id,
        claimStatus: {
          in: ['unclaimed', 'pending'],
        },
        email: membership.identity.email,
        ...(membership.identity.updatedAt ? { updatedAt: membership.identity.updatedAt } : {}),
      },
      data: {
        claimStatus: 'pending',
      },
    });

    if (promoted.count === 0) {
      throw new CustomerAuthError('claim_not_allowed');
    }

    return tx.identity.findUnique({
      where: { id: membership.identity.id },
      select: {
        updatedAt: true,
      },
    });
  });

  if (!updated) {
    throw new CustomerAuthError('account_not_found');
  }

  return {
    customerId: membership.customer.id,
    identityId: membership.identity.id,
    claimStatus: 'pending',
    email,
    token: issueSignedClaimToken({
      customerId: membership.customer.id,
      identityId: membership.identity.id,
      email,
      updatedAt: updated.updatedAt ?? membership.identity.updatedAt,
    }),
  };
}

export async function completeCustomerClaim(
  client: ClaimMembershipClient,
  input: CompleteCustomerClaimInput,
): Promise<CustomerAuthResult> {
  const payload = verifyClaimToken(input.token);
  const membership = await findClaimOwnership(client, {
    customerId: payload.sub,
    identityId: payload.identityId,
  });

  if (!membership) {
    throw new CustomerAuthError('account_not_found');
  }

  const currentStateFingerprint = buildStateFingerprint(membership.identity.updatedAt);
  if (
    payload.stateFingerprint &&
    currentStateFingerprint &&
    payload.stateFingerprint !== currentStateFingerprint
  ) {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  const email = normalizeEmail(payload.email);
  const passwordHash = await hashPassword(input.password);

  await client.$transaction(async (tx) => {
    let completed;
    try {
      completed = await tx.identity.updateMany({
        where: {
          id: membership.identity.id,
          claimStatus: 'pending',
          ...(membership.identity.updatedAt ? { updatedAt: membership.identity.updatedAt } : {}),
        },
        data: {
          email,
          passwordHash,
          claimStatus: 'active',
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error, 'email')) {
        throw new CustomerAuthError('email_already_exists');
      }
      throw error;
    }

    if (completed.count === 0) {
      throw new CustomerAuthError('invalid_or_expired_token');
    }
  });

  return buildCustomerAuthResult({
    customerId: membership.customer.id,
    identityId: membership.identity.id,
    email,
    membershipRole: membership.role,
  });
}
