import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260419010000_drop_legacy_coke_auth_tables/migration.sql',
);

function getModelBlock(schema: string, modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, 'm'));
  expect(match, `expected to find model ${modelName}`).toBeTruthy();
  return match?.[0].replace(/[ \t]+/g, ' ') ?? '';
}

describe('coke auth retirement schema guard', () => {
  it('removes legacy auth models while keeping compatibility identifiers wired to neutral models', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const compactSchema = schema.replace(/[ \t]+/g, ' ');
    const clawscaleUserModel = getModelBlock(schema, 'ClawscaleUser');
    const customerModel = getModelBlock(schema, 'Customer');
    const subscriptionModel = getModelBlock(schema, 'Subscription');

    expect(compactSchema).not.toContain('enum CokeAccountStatus');
    expect(compactSchema).not.toContain('enum VerifyTokenType');
    expect(compactSchema).not.toContain('model CokeAccount {');
    expect(compactSchema).not.toContain('model VerifyToken {');

    expect(clawscaleUserModel).toContain('cokeAccountId String @map("coke_account_id")');
    expect(clawscaleUserModel).toContain(
      'customer Customer @relation(fields: [cokeAccountId], references: [id], onDelete: Cascade)',
    );
    expect(clawscaleUserModel).not.toContain('account CokeAccount');

    expect(customerModel).toContain('clawscaleUser ClawscaleUser?');

    expect(subscriptionModel).toContain('customerId String @map("customer_id")');
    expect(subscriptionModel).not.toContain('cokeAccountId');
  });
});

describe('coke auth retirement migration guard', () => {
  it('drops legacy auth tables and rewires compatibility references away from coke_accounts', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const compactMigration = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ');

    expect(compactMigration).toContain('DROP TABLE IF EXISTS "verify_tokens"');
    expect(compactMigration).toContain('DROP TABLE IF EXISTS "coke_accounts"');
    expect(compactMigration).toContain('DROP TYPE IF EXISTS "VerifyTokenType"');
    expect(compactMigration).toContain('DROP TYPE IF EXISTS "CokeAccountStatus"');
    expect(compactMigration).toContain('DROP CONSTRAINT IF EXISTS "clawscale_users_coke_account_id_fkey"');
    expect(compactMigration).toContain(
      'FOREIGN KEY ("coke_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE',
    );
    expect(compactMigration).toContain('DROP CONSTRAINT IF EXISTS "subscriptions_coke_account_id_fkey"');
    expect(compactMigration).toContain('DROP INDEX IF EXISTS "subscriptions_coke_account_id_idx"');
    expect(compactMigration).toContain('DROP INDEX IF EXISTS "subscriptions_coke_account_id_expires_at_idx"');
    expect(compactMigration).toContain('DROP COLUMN IF EXISTS "coke_account_id"');
  });
});
