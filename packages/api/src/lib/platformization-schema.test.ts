import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260416010000_platformization_identity_schema/migration.sql',
);

function getModelBlock(schema: string, modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, 'm'));
  expect(match, `expected to find model ${modelName}`).toBeTruthy();
  return match?.[0].replace(/[ \t]+/g, ' ') ?? '';
}

describe('platformization schema guard', () => {
  it('includes the dormant identity graph and shared-channel ownership fields', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const compactSchema = schema.replace(/[ \t]+/g, ' ');
    const identityModel = getModelBlock(schema, 'Identity');
    const customerModel = getModelBlock(schema, 'Customer');
    const membershipModel = getModelBlock(schema, 'Membership');
    const agentModel = getModelBlock(schema, 'Agent');
    const agentBindingModel = getModelBlock(schema, 'AgentBinding');
    const adminAccountModel = getModelBlock(schema, 'AdminAccount');
    const externalIdentityModel = getModelBlock(schema, 'ExternalIdentity');
    const channelModel = getModelBlock(schema, 'Channel');

    expect(compactSchema).toContain('enum IdentityClaimStatus');
    expect(compactSchema).toContain('enum CustomerKind');
    expect(compactSchema).toContain('enum MembershipRole');
    expect(compactSchema).toContain('enum AgentBindingProvisionStatus');
    expect(compactSchema).toContain('enum ChannelOwnershipKind');

    expect(identityModel).toContain('id String @id @default(uuid())');
    expect(identityModel).toContain('email String? @unique');
    expect(identityModel).toContain('phone String?');
    expect(identityModel).toContain('passwordHash String? @map("password_hash")');
    expect(identityModel).toContain('claimStatus IdentityClaimStatus @default(active) @map("claim_status")');
    expect(identityModel).toContain('memberships Membership[]');
    expect(identityModel).not.toContain('externalIdentities');

    expect(customerModel).toContain('memberships Membership[]');
    expect(customerModel).toContain('channels Channel[]');
    expect(customerModel).toContain('agentBindings AgentBinding[]');
    expect(customerModel).toContain('externalIdentities ExternalIdentity[]');

    expect(membershipModel).toContain('id String @id @default(uuid())');
    expect(membershipModel).toContain('role MembershipRole @default(owner)');
    expect(membershipModel).toContain('@@unique([identityId, customerId])');
    expect(membershipModel).toContain('@@index([identityId])');
    expect(membershipModel).toContain('@@index([customerId])');

    expect(agentModel).toContain('id String @id @default(uuid())');
    expect(agentModel).toContain('sharedChannels Channel[]');

    expect(agentBindingModel).toContain('id String @id @default(uuid())');
    expect(agentBindingModel).toContain('provisionUpdatedAt DateTime @default(now()) @map("provision_updated_at")');
    expect(agentBindingModel).toContain('@@unique([customerId])');
    expect(agentBindingModel).toContain('@@index([agentId])');
    expect(agentBindingModel).toContain(
      'agent Agent @relation(fields: [agentId], references: [id], onDelete: Restrict)',
    );

    expect(adminAccountModel).toContain('id String @id @default(uuid())');
    expect(adminAccountModel).toContain('email String @unique');
    expect(adminAccountModel).toContain('passwordHash String @map("password_hash")');
    expect(adminAccountModel).toContain('mfaSecret String? @map("mfa_secret")');
    expect(adminAccountModel).not.toContain('name String');

    expect(externalIdentityModel).toContain('identityType String @map("identity_type")');
    expect(externalIdentityModel).toContain('identityValue String @map("identity_value")');
    expect(externalIdentityModel).toContain('customerId String @map("customer_id")');
    expect(externalIdentityModel).toContain(
      'firstSeenChannelId String @map("first_seen_channel_id")',
    );
    expect(externalIdentityModel).toContain(
      'firstSeenAt DateTime @default(now()) @map("first_seen_at")',
    );
    expect(externalIdentityModel).toContain(
      'lastSeenAt DateTime @default(now()) @map("last_seen_at")',
    );
    expect(externalIdentityModel).toContain(
      'customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)',
    );
    expect(externalIdentityModel).toContain(
      'firstSeenChannel Channel @relation(fields: [firstSeenChannelId], references: [id], onDelete: Restrict)',
    );
    expect(externalIdentityModel).toContain('@@unique([provider, identityType, identityValue])');
    expect(externalIdentityModel).toContain('@@index([customerId])');

    expect(channelModel).toContain(
      'ownershipKind ChannelOwnershipKind @default(customer) @map("ownership_kind")',
    );
    expect(channelModel).toContain('customerId String? @map("customer_id")');
    expect(channelModel).toContain('agentId String? @map("agent_id")');
    expect(channelModel).toContain(
      'customer Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)',
    );
    expect(channelModel).toContain(
      'sharedAgent Agent? @relation(fields: [agentId], references: [id], onDelete: SetNull)',
    );
  });
});

describe('platformization migration guard', () => {
  it('includes the required safety backfill and dormant platform indexes/constraints', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const compactMigration = migration.replace(/\s+/g, ' ');

    expect(compactMigration).toContain('agents_is_default_true_key');
    expect(compactMigration).toContain('channels_ownership_kind_check');
    expect(compactMigration).toContain('channels_customer_kind_active_key');
    expect(compactMigration).toContain('memberships_identity_id_idx');
    expect(compactMigration).toContain('INSERT INTO "customers"');
    expect(compactMigration).toContain(
      'SELECT "coke_accounts"."id", \'personal\'::"CustomerKind", "coke_accounts"."display_name"',
    );
    expect(compactMigration).toContain(
      '"coke_accounts"."created_at", "coke_accounts"."updated_at"',
    );
    expect(compactMigration).toContain('FROM "coke_accounts"');
    expect(compactMigration).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(compactMigration).toContain('UPDATE "channels"');
    expect(compactMigration).toContain('SET "customer_id" = "clawscale_users"."coke_account_id"');
    expect(compactMigration).toContain('FROM "clawscale_users"');
    expect(compactMigration).toContain(
      'WHERE "channels"."owner_clawscale_user_id" = "clawscale_users"."id"',
    );
    expect(compactMigration).toContain(
      '("ownership_kind" = \'customer\'::"ChannelOwnershipKind" AND "customer_id" IS NOT NULL)',
    );
    expect(compactMigration).toContain(
      '("ownership_kind" = \'shared\'::"ChannelOwnershipKind" AND "customer_id" IS NULL AND "agent_id" IS NOT NULL)',
    );
  });
});
