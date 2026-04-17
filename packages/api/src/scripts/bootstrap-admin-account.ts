import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { db } from '../db/index.js';
import { hashAdminPassword, normalizeAdminEmail } from '../lib/admin-auth.js';

const ADMIN_BOOTSTRAP_LOCK_KEY = 50421017;
export const MIN_BOOTSTRAP_PASSWORD_LENGTH = 8;

type BootstrapEnv = {
  ADMIN_BOOTSTRAP_EMAIL?: string;
  ADMIN_BOOTSTRAP_PASSWORD?: string;
};

type BootstrapAccount = {
  id: string;
  email: string;
  isActive: boolean;
};

type BootstrapTransactionClient = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  adminAccount: {
    findFirst(args: {
      orderBy: {
        createdAt: 'asc';
      };
    }): Promise<BootstrapAccount | null>;
    create(args: {
      data: {
        email: string;
        passwordHash: string;
        isActive: boolean;
      };
    }): Promise<BootstrapAccount>;
  };
};

type BootstrapClient = {
  $transaction<T>(fn: (client: BootstrapTransactionClient) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
};

export type BootstrapAdminAccountResult =
  | {
      status: 'created';
      account: BootstrapAccount;
    }
  | {
      status: 'skipped';
      existingAccount: BootstrapAccount;
    };

function readRequiredEnv(env: BootstrapEnv, name: keyof BootstrapEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function readBootstrapAdminEnv(env: BootstrapEnv): {
  email: string;
  password: string;
} {
  const email = normalizeAdminEmail(readRequiredEnv(env, 'ADMIN_BOOTSTRAP_EMAIL'));
  const password = readRequiredEnv(env, 'ADMIN_BOOTSTRAP_PASSWORD');

  if (password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters`,
    );
  }

  return { email, password };
}

export async function bootstrapAdminAccount(
  client: BootstrapClient,
  env: BootstrapEnv,
): Promise<BootstrapAdminAccountResult> {
  const { email, password } = readBootstrapAdminEnv(env);
  const passwordHash = await hashAdminPassword(password);

  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', ADMIN_BOOTSTRAP_LOCK_KEY);

    const existingAccount = await tx.adminAccount.findFirst({
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (existingAccount) {
      return {
        status: 'skipped',
        existingAccount,
      };
    }

    const account = await tx.adminAccount.create({
      data: {
        email,
        passwordHash,
        isActive: true,
      },
    });

    return {
      status: 'created',
      account,
    };
  });
}

export async function main(
  client: BootstrapClient = db,
  env: BootstrapEnv = process.env,
  logger: Pick<typeof console, 'log'> = console,
): Promise<void> {
  const result = await bootstrapAdminAccount(client, env);

  if (result.status === 'skipped') {
    logger.log(
      `[bootstrap-admin-account] skipped: admin account already exists (${result.existingAccount.email})`,
    );
    return;
  }

  logger.log(`[bootstrap-admin-account] created ${result.account.email} (${result.account.id})`);
}

const executedAsScript =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedAsScript) {
  main()
    .catch((error) => {
      console.error('[bootstrap-admin-account] failed', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
