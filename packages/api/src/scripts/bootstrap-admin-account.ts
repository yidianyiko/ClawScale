import 'dotenv/config';
import { db } from '../db/index.js';
import { hashAdminPassword, normalizeAdminEmail } from '../lib/admin-auth.js';

function readRequiredEnv(name: 'ADMIN_BOOTSTRAP_EMAIL' | 'ADMIN_BOOTSTRAP_PASSWORD'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function main(): Promise<void> {
  const existingCount = await db.adminAccount.count();
  if (existingCount > 0) {
    console.log('[bootstrap-admin-account] skipped: admin account already exists');
    return;
  }

  const email = normalizeAdminEmail(readRequiredEnv('ADMIN_BOOTSTRAP_EMAIL'));
  const password = readRequiredEnv('ADMIN_BOOTSTRAP_PASSWORD');
  const passwordHash = await hashAdminPassword(password);

  const account = await db.adminAccount.create({
    data: {
      email,
      passwordHash,
      isActive: true,
    },
  });

  console.log(`[bootstrap-admin-account] created ${account.email} (${account.id})`);
}

main()
  .catch((error) => {
    console.error('[bootstrap-admin-account] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
