import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');

describe('platformization schema guard', () => {
  it('includes the dormant identity graph and shared-channel ownership fields', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const compactSchema = schema.replace(/[ \t]+/g, ' ');

    expect(compactSchema).toContain('enum IdentityClaimStatus');
    expect(compactSchema).toContain('enum CustomerKind');
    expect(compactSchema).toContain('enum MembershipRole');
    expect(compactSchema).toContain('enum AgentBindingProvisionStatus');
    expect(compactSchema).toContain('enum ChannelOwnershipKind');

    expect(compactSchema).toContain('model Identity');
    expect(compactSchema).toContain('id String @id @default(uuid())');
    expect(compactSchema).toContain('email String? @unique');
    expect(compactSchema).toContain('phone String?');
    expect(compactSchema).toContain('passwordHash String? @map("password_hash")');
    expect(compactSchema).toContain('claimStatus IdentityClaimStatus @default(active) @map("claim_status")');

    expect(compactSchema).toContain('model Customer');
    expect(compactSchema).toContain('externalIdentities ExternalIdentity[]');

    expect(compactSchema).toContain('model Membership');
    expect(compactSchema).toContain('id String @id @default(uuid())');
    expect(compactSchema).toContain('role MembershipRole @default(owner)');
    expect(compactSchema).toContain('@@unique([identityId, customerId])');
    expect(compactSchema).toContain('@@index([customerId])');

    expect(compactSchema).toContain('model Agent');
    expect(compactSchema).toContain('sharedChannels Channel[]');

    expect(compactSchema).toContain('model AgentBinding');
    expect(compactSchema).toContain('id String @id @default(uuid())');
    expect(compactSchema).toContain('provisionUpdatedAt DateTime @default(now()) @map("provision_updated_at")');
    expect(compactSchema).toContain('@@unique([customerId])');
    expect(compactSchema).toContain('@@index([agentId])');
    expect(compactSchema).toContain('agent Agent @relation(fields: [agentId], references: [id], onDelete: Restrict)');

    expect(compactSchema).toContain('model AdminAccount');
    expect(compactSchema).toContain('id String @id @default(uuid())');
    expect(compactSchema).toContain('mfaSecret String? @map("mfa_secret")');

    expect(compactSchema).toContain('model ExternalIdentity');
    expect(compactSchema).toContain('identityType String @map("identity_type")');
    expect(compactSchema).toContain('identityValue String @map("identity_value")');
    expect(compactSchema).toContain('customerId String @map("customer_id")');
    expect(compactSchema).toContain('firstSeenChannelId String @map("first_seen_channel_id")');
    expect(compactSchema).toContain('firstSeenAt DateTime @default(now()) @map("first_seen_at")');
    expect(compactSchema).toContain('lastSeenAt DateTime @default(now()) @map("last_seen_at")');
    expect(compactSchema).toContain('customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)');
    expect(compactSchema).toContain('firstSeenChannel Channel @relation(fields: [firstSeenChannelId], references: [id], onDelete: Restrict)');
    expect(compactSchema).toContain('@@unique([provider, identityType, identityValue])');
    expect(compactSchema).toContain('@@index([customerId])');

    expect(compactSchema).toContain('ownershipKind ChannelOwnershipKind @default(customer) @map("ownership_kind")');
    expect(compactSchema).toContain('customerId String? @map("customer_id")');
    expect(compactSchema).toContain('agentId String? @map("agent_id")');
    expect(compactSchema).toContain('sharedAgent Agent? @relation(fields: [agentId], references: [id], onDelete: SetNull)');
  });
});
