import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateId } from './id.js';

const CUSTOMER_JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '7d';
const CUSTOMER_ACTION_TOKEN_EXPIRES_IN: jwt.SignOptions['expiresIn'] = '15m';
const BCRYPT_ROUNDS = 10;

export type CustomerClaimStatus = 'active' | 'unclaimed' | 'pending';
export type CustomerMembershipRole = 'owner' | 'member' | 'viewer';
export type CustomerActionPurpose = 'verify_email' | 'password_reset';

export interface CustomerJwtPayload {
  sub: string;
  identityId: string;
  email: string;
  tokenType: 'access';
  iat?: number;
  exp?: number;
}

export interface CustomerActionTokenPayload
  extends Omit<CustomerJwtPayload, 'tokenType'> {
  tokenType: 'action';
  purpose: CustomerActionPurpose;
  passwordFingerprint?: string;
  stateFingerprint?: string;
}

export interface CustomerAuthResult {
  customerId: string;
  identityId: string;
  claimStatus: CustomerClaimStatus;
  email: string;
  membershipRole: CustomerMembershipRole;
  token: string;
}

export interface CustomerSession {
  customerId: string;
  identityId: string;
  claimStatus: CustomerClaimStatus;
  email: string;
  membershipRole: CustomerMembershipRole;
}

export interface RegisterCustomerInput {
  displayName: string;
  email: string;
  password: string;
}

export interface AuthenticateCustomerInput {
  email: string;
  password: string;
}

export interface GetCustomerSessionInput {
  customerId: string;
  identityId: string;
}

export interface VerifyCustomerEmailInput {
  email: string;
  token: string;
}

export interface ResetCustomerPasswordInput {
  token: string;
  password: string;
}

export interface IssueCustomerActionTokenInput {
  purpose: CustomerActionPurpose;
  customerId: string;
  identityId: string;
  email: string;
  passwordHash?: string | null;
  updatedAt?: Date;
}

interface MembershipRecord {
  role: CustomerMembershipRole;
  customer: {
    id: string;
  };
  identity: {
    id: string;
    email: string | null;
    claimStatus: CustomerClaimStatus;
    passwordHash?: string | null;
    updatedAt?: Date;
  };
}

interface RegistrationTransactionClient {
  identity: {
    create(args: {
      data: {
        email: string;
        displayName: string;
        passwordHash: string;
        claimStatus: CustomerClaimStatus;
      };
    }): Promise<{
      id: string;
      email: string | null;
      claimStatus: CustomerClaimStatus;
    }>;
    update(args: {
      where: {
        id: string;
      };
      data: {
        passwordHash?: string;
        claimStatus?: CustomerClaimStatus;
      };
    }): Promise<unknown>;
  };
  customer: {
    create(args: {
      data: {
        id: string;
        kind: 'personal';
        displayName: string;
      };
    }): Promise<{
      id: string;
    }>;
  };
  membership: {
    create(args: {
      data: {
        identityId: string;
        customerId: string;
        role: CustomerMembershipRole;
      };
    }): Promise<{
      role: CustomerMembershipRole;
    }>;
  };
}

interface CustomerAuthClient {
  identity: {
    findUnique(args: {
      where: {
        email: string;
      };
      select: {
        id: true;
      };
    }): Promise<{ id: string } | null>;
  };
  membership: {
    findFirst(args: {
      where: Record<string, unknown>;
      include: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }): Promise<MembershipRecord | null>;
    findMany?(args: {
      where: Record<string, unknown>;
      include: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
    }): Promise<MembershipRecord[]>;
  };
  $transaction<T>(fn: (client: RegistrationTransactionClient) => Promise<T>): Promise<T>;
}

export class CustomerAuthError extends Error {
  constructor(
    public readonly code:
      | 'email_already_exists'
      | 'invalid_credentials'
      | 'invalid_or_expired_token'
      | 'account_not_found'
      | 'claim_not_allowed',
  ) {
    super(code);
    this.name = 'CustomerAuthError';
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

function buildPasswordFingerprint(passwordHash?: string | null): string | undefined {
  if (!passwordHash) {
    return undefined;
  }

  return sha256Hex(passwordHash);
}

function buildStateFingerprint(updatedAt?: Date): string | undefined {
  if (!updatedAt) {
    return undefined;
  }

  return sha256Hex(updatedAt.toISOString());
}

function buildCustomerAuthResult(input: {
  customerId: string;
  identityId: string;
  claimStatus: CustomerClaimStatus;
  email: string;
  membershipRole: CustomerMembershipRole;
}): CustomerAuthResult {
  return {
    customerId: input.customerId,
    identityId: input.identityId,
    claimStatus: input.claimStatus,
    email: input.email,
    membershipRole: input.membershipRole,
    token: signCustomerToken({
      customerId: input.customerId,
      identityId: input.identityId,
      email: input.email,
    }),
  };
}

function toCustomerSession(record: MembershipRecord): CustomerSession | null {
  const email = record.identity.email?.trim();
  if (!email) {
    return null;
  }

  return {
    customerId: record.customer.id,
    identityId: record.identity.id,
    claimStatus: record.identity.claimStatus,
    email,
    membershipRole: record.role,
  };
}

async function findOwnerMembershipsByEmail(
  client: Pick<CustomerAuthClient, 'membership'>,
  email: string,
): Promise<MembershipRecord[]> {
  return (
    (await client.membership.findMany?.({
      where: {
        role: 'owner',
        identity: {
          email,
        },
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
            passwordHash: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 2,
    })) ?? []
  );
}

async function findMembershipByIds(
  client: Pick<CustomerAuthClient, 'membership'>,
  input: GetCustomerSessionInput,
): Promise<MembershipRecord | null> {
  return client.membership.findFirst({
    where: {
      customerId: input.customerId,
      identityId: input.identityId,
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
        },
      },
    },
  });
}

async function findMembershipByIdsWithIdentityState(
  client: Pick<CustomerAuthClient, 'membership'>,
  input: GetCustomerSessionInput,
): Promise<MembershipRecord | null> {
  return client.membership.findFirst({
    where: {
      customerId: input.customerId,
      identityId: input.identityId,
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
          passwordHash: true,
          updatedAt: true,
        },
      },
    },
  });
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

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signCustomerToken(payload: {
  customerId: string;
  identityId: string;
  email: string;
}): string {
  return jwt.sign(
    {
      sub: payload.customerId,
      identityId: payload.identityId,
      email: payload.email,
      tokenType: 'access',
    },
    readCustomerJwtSecret(),
    { expiresIn: CUSTOMER_JWT_EXPIRES_IN },
  );
}

export function verifyCustomerToken(token: string): CustomerJwtPayload {
  let payload: CustomerJwtPayload;
  try {
    payload = jwt.verify(token, readCustomerJwtSecret()) as CustomerJwtPayload;
  } catch {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  if (payload.tokenType !== 'access') {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  return payload;
}

export function issueCustomerActionToken(input: IssueCustomerActionTokenInput): string {
  return jwt.sign(
    {
      sub: input.customerId,
      identityId: input.identityId,
      email: normalizeEmail(input.email),
      tokenType: 'action',
      purpose: input.purpose,
      passwordFingerprint: buildPasswordFingerprint(input.passwordHash),
      stateFingerprint: buildStateFingerprint(input.updatedAt),
    },
    readCustomerJwtSecret(),
    { expiresIn: CUSTOMER_ACTION_TOKEN_EXPIRES_IN },
  );
}

function verifyCustomerActionToken(
  token: string,
  purpose: CustomerActionPurpose,
): CustomerActionTokenPayload {
  let payload: CustomerActionTokenPayload;
  try {
    payload = jwt.verify(token, readCustomerJwtSecret()) as CustomerActionTokenPayload;
  } catch {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  if (payload.purpose !== purpose) {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  return payload;
}

export async function registerCustomer(
  client: CustomerAuthClient,
  input: RegisterCustomerInput,
): Promise<CustomerAuthResult> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  const existing = await client.identity.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    throw new CustomerAuthError('email_already_exists');
  }

  const passwordHash = await hashPassword(input.password);

  try {
    return await client.$transaction(async (tx) => {
      const identity = await tx.identity.create({
        data: {
          email,
          displayName,
          passwordHash,
          claimStatus: 'pending',
        },
      });
      const customer = await tx.customer.create({
        data: {
          id: generateId('ck'),
          kind: 'personal',
          displayName,
        },
      });
      const membership = await tx.membership.create({
        data: {
          identityId: identity.id,
          customerId: customer.id,
          role: 'owner',
        },
      });

      return buildCustomerAuthResult({
        customerId: customer.id,
        identityId: identity.id,
        claimStatus: identity.claimStatus,
        email,
        membershipRole: membership.role,
      });
    });
  } catch (error) {
    if (isUniqueConstraint(error, 'email')) {
      throw new CustomerAuthError('email_already_exists');
    }

    throw error;
  }
}

export async function authenticateCustomer(
  client: Pick<CustomerAuthClient, 'membership'>,
  input: AuthenticateCustomerInput,
): Promise<CustomerAuthResult> {
  const email = normalizeEmail(input.email);
  const memberships = await findOwnerMembershipsByEmail(client, email);
  if (memberships.length !== 1) {
    throw new CustomerAuthError('invalid_credentials');
  }

  const [membership] = memberships;
  if (!membership?.identity.passwordHash || !membership.identity.email) {
    throw new CustomerAuthError('invalid_credentials');
  }

  const valid = await verifyPassword(input.password, membership.identity.passwordHash);
  if (!valid) {
    throw new CustomerAuthError('invalid_credentials');
  }

  return buildCustomerAuthResult({
    customerId: membership.customer.id,
    identityId: membership.identity.id,
    claimStatus: membership.identity.claimStatus,
    email: membership.identity.email,
    membershipRole: membership.role,
  });
}

export async function getCustomerSession(
  client: Pick<CustomerAuthClient, 'membership'>,
  input: GetCustomerSessionInput,
): Promise<CustomerSession | null> {
  const membership = await findMembershipByIds(client, input);
  if (!membership) {
    return null;
  }

  return toCustomerSession(membership);
}

export async function verifyCustomerEmail(
  client: CustomerAuthClient,
  input: VerifyCustomerEmailInput,
): Promise<CustomerAuthResult> {
  const payload = verifyCustomerActionToken(input.token, 'verify_email');
  const normalizedEmail = normalizeEmail(input.email);

  if (normalizedEmail !== normalizeEmail(payload.email)) {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  const membership = await findMembershipByIdsWithIdentityState(client, {
    customerId: payload.sub,
    identityId: payload.identityId,
  });

  if (!membership?.identity.email || normalizeEmail(membership.identity.email) !== normalizedEmail) {
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

  await client.$transaction(async (tx) => {
    await tx.identity.update({
      where: { id: membership.identity.id },
      data: {
        claimStatus: 'active',
      },
    });
  });

  return buildCustomerAuthResult({
    customerId: membership.customer.id,
    identityId: membership.identity.id,
    claimStatus: 'active',
    email: membership.identity.email,
    membershipRole: membership.role,
  });
}

export async function resetCustomerPassword(
  client: CustomerAuthClient,
  input: ResetCustomerPasswordInput,
): Promise<void> {
  const payload = verifyCustomerActionToken(input.token, 'password_reset');
  const membership = await findMembershipByIdsWithIdentityState(client, {
    customerId: payload.sub,
    identityId: payload.identityId,
  });

  if (!membership?.identity.passwordHash) {
    throw new CustomerAuthError('account_not_found');
  }

  const currentFingerprint = buildPasswordFingerprint(membership.identity.passwordHash);
  if (
    payload.passwordFingerprint &&
    currentFingerprint &&
    payload.passwordFingerprint !== currentFingerprint
  ) {
    throw new CustomerAuthError('invalid_or_expired_token');
  }

  const nextPasswordHash = await hashPassword(input.password);
  await client.$transaction(async (tx) => {
    await tx.identity.update({
      where: { id: membership.identity.id },
      data: {
        passwordHash: nextPasswordHash,
      },
    });
  });
}
