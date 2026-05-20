import type { ApiResponse } from '@clawscale/shared';
import type { DB } from '../db/index.js';
import { resolveCokeAccountAccess } from '../lib/coke-account-access.js';
import { ensureClawscaleUserForCustomer } from '../lib/clawscale-user.js';

export type CustomerChannelLifecycleAction =
  | 'create'
  | 'connect'
  | 'disconnect'
  | 'delete'
  | 'status';

export type CustomerChannelServiceErrorCode =
  | 'unauthorized'
  | 'invalid_or_expired_token'
  | 'account_not_found'
  | 'claim_inactive'
  | 'account_suspended'
  | 'email_not_verified'
  | 'subscription_required';

export interface CustomerChannelActionRequest {
  action: CustomerChannelLifecycleAction;
  customerId: string;
  identityId: string;
}

export interface CustomerChannelAuthResult {
  tenantId: string;
  clawscaleUserId: string;
}

export interface CustomerChannelServiceError {
  code: CustomerChannelServiceErrorCode;
}

export interface CustomerChannelService {
  resolvePersonalWechatAuth(
    input: CustomerChannelActionRequest,
  ): Promise<CustomerChannelAuthResult>;
}

type CustomerChannelDb = Pick<DB, 'membership'>;

interface CustomerChannelServiceLogger {
  info(input: {
    event: 'customer_channel_action';
    action: CustomerChannelLifecycleAction;
    customer_id_hash: string;
    outcome: 'ok' | CustomerChannelServiceErrorCode;
  }): void;
}

interface CreateCustomerChannelServiceInput {
  db: CustomerChannelDb;
  logger?: CustomerChannelServiceLogger;
}

class CustomerChannelServiceException extends Error implements CustomerChannelServiceError {
  constructor(public readonly code: CustomerChannelServiceErrorCode) {
    super(code);
    this.name = 'CustomerChannelServiceException';
  }
}

const defaultLogger: CustomerChannelServiceLogger = {
  info(input) {
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }

    console.info(
      JSON.stringify({
        scope: 'channel.customer-service',
        ...input,
      }),
    );
  },
};

function hashCustomerId(customerId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < customerId.length; i += 1) {
    hash ^= customerId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function logChannelAction(
  logger: CustomerChannelServiceLogger,
  request: CustomerChannelActionRequest,
  outcome: 'ok' | CustomerChannelServiceErrorCode,
): void {
  logger.info({
    event: 'customer_channel_action',
    action: request.action,
    customer_id_hash: hashCustomerId(request.customerId),
    outcome,
  });
}

export function channelServiceErrorToHttp(error: CustomerChannelServiceError): {
  status: 401 | 402 | 403 | 404;
  body: ApiResponse<never>;
} {
  if (error.code === 'account_not_found') {
    return { status: 404, body: { ok: false, error: error.code } };
  }

  if (error.code === 'unauthorized' || error.code === 'invalid_or_expired_token') {
    return { status: 401, body: { ok: false, error: error.code } };
  }

  if (error.code === 'subscription_required') {
    return { status: 402, body: { ok: false, error: error.code } };
  }

  return { status: 403, body: { ok: false, error: error.code } };
}

function toServiceError(code: CustomerChannelServiceErrorCode): CustomerChannelServiceException {
  return new CustomerChannelServiceException(code);
}

function shouldGateProvisioning(action: CustomerChannelLifecycleAction): boolean {
  return action === 'create' || action === 'connect';
}

function enforceAccessForAction(
  action: CustomerChannelLifecycleAction,
  deniedReason: string | null,
): void {
  if (!shouldGateProvisioning(action)) {
    return;
  }

  if (deniedReason === 'account_suspended') {
    throw toServiceError('account_suspended');
  }

  if (deniedReason === 'email_not_verified') {
    throw toServiceError('email_not_verified');
  }

  if (action === 'connect' && deniedReason === 'subscription_required') {
    throw toServiceError('subscription_required');
  }
}

async function loadCompatibilityCustomerAccount(
  db: CustomerChannelDb,
  input: {
    customerId: string;
    identityId: string;
  },
): Promise<{
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  status: 'normal';
} | null> {
  const membership = await db.membership.findFirst({
    where: {
      customerId: input.customerId,
      identityId: input.identityId,
      role: 'owner',
    },
    include: {
      customer: {
        select: {
          id: true,
          displayName: true,
        },
      },
      identity: {
        select: {
          email: true,
          claimStatus: true,
        },
      },
    },
  });

  const email = membership?.identity.email?.trim();
  if (!membership || !email || !membership.customer.id.startsWith('ck_')) {
    return null;
  }

  return {
    id: membership.customer.id,
    displayName: membership.customer.displayName,
    email,
    emailVerified: membership.identity.claimStatus === 'active',
    status: 'normal',
  };
}

export function createCustomerChannelService(
  input: CreateCustomerChannelServiceInput,
): CustomerChannelService {
  const logger = input.logger ?? defaultLogger;

  return {
    async resolvePersonalWechatAuth(
      request: CustomerChannelActionRequest,
    ): Promise<CustomerChannelAuthResult> {
      try {
        const account = await loadCompatibilityCustomerAccount(input.db, {
          customerId: request.customerId,
          identityId: request.identityId,
        });

        if (!account) {
          throw toServiceError('account_not_found');
        }

        const access = await resolveCokeAccountAccess({
          account: {
            id: account.id,
            status: account.status,
            emailVerified: account.emailVerified,
            displayName: account.displayName,
          },
        });

        enforceAccessForAction(request.action, access.accountAccessDeniedReason);

        const ensured = await ensureClawscaleUserForCustomer({
          customerId: account.id,
        });

        logChannelAction(logger, request, 'ok');
        return {
          tenantId: ensured.tenantId,
          clawscaleUserId: ensured.clawscaleUserId,
        };
      } catch (error) {
        if (
          error instanceof CustomerChannelServiceException ||
          (typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string' &&
            [
              'unauthorized',
              'invalid_or_expired_token',
              'account_not_found',
              'claim_inactive',
              'account_suspended',
              'email_not_verified',
              'subscription_required',
            ].includes(error.code))
        ) {
          const code = (error as CustomerChannelServiceError).code;
          logChannelAction(logger, request, code);
        }

        throw error;
      }
    },
  };
}
