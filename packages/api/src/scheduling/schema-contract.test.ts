import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
const migrationPath = join(
  process.cwd(),
  'prisma/migrations/20260521090000_user_link_scheduling/migration.sql',
);

describe('user-link scheduling schema contract', () => {
  it('declares scheduling models and no hold expiry field', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('model UserLink');
    expect(schema).toContain('model LinkSession');
    expect(schema).toContain('model ServiceLink');
    expect(schema).toContain('model BookableWindow');
    expect(schema).toContain('model BookableWindowExclusion');
    expect(schema).toContain('model AppointmentRequest');
    expect(schema).toContain('model AppointmentEvent');
    expect(schema).toContain('model SchedulingNotification');
    expect(schema).toContain('tagline     String?  @db.VarChar(120)');
    expect(schema).toContain('avatarUrl   String?  @map("avatar_url")');
    expect(schema).not.toContain('holdExpiresAt');
    expect(schema).not.toContain('expired');
  });

  it('adds database-level uniqueness for active links and occupied instances', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX "user_links_one_active_per_account"');
    expect(sql).toContain("WHERE status = 'active'");
    expect(sql).toContain('CREATE UNIQUE INDEX "bookable_windows_active_fingerprint_uniq"');
    expect(sql).toContain('CREATE UNIQUE INDEX "appointment_instance_occupancy_uniq"');
    expect(sql).toContain("WHERE status IN ('pending_held', 'confirmed_shared')");
    expect(sql).toContain('CREATE UNIQUE INDEX "service_links_provider_consumer_uniq"');
    expect(sql).toContain('CREATE UNIQUE INDEX "appointment_requests_provider_account_id_consumer_account_id_idempotency_key_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "appointment_events_idempotency_key_key"');
  });

  it('enforces denormalized scheduling ownership with composite constraints', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const sql = readFileSync(migrationPath, 'utf8');

    expect(schema).toContain('@@unique([id, providerAccountId])');
    expect(schema).toContain('@@unique([id, providerAccountId, consumerAccountId])');
    expect(schema).toContain(
      'userLink UserLink @relation(fields: [userLinkId, providerAccountId], references: [id, providerAccountId], onDelete: Cascade)',
    );
    expect(schema).toContain(
      'serviceLink ServiceLink @relation(fields: [serviceLinkId, providerAccountId, consumerAccountId], references: [id, providerAccountId, consumerAccountId], onDelete: Restrict)',
    );
    expect(schema).toContain(
      'bookableWindow BookableWindow @relation(fields: [bookableWindowId, providerAccountId], references: [id, providerAccountId], onDelete: Restrict)',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("user_link_id", "provider_account_id") REFERENCES "user_links"("id", "provider_account_id")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("service_link_id", "provider_account_id", "consumer_account_id") REFERENCES "service_links"("id", "provider_account_id", "consumer_account_id")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("bookable_window_id", "provider_account_id") REFERENCES "bookable_windows"("id", "provider_account_id")',
    );
  });
});
