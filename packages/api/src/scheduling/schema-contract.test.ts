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
    expect(sql).toContain('CREATE UNIQUE INDEX "appointment_instance_occupancy_uniq"');
    expect(sql).toContain("WHERE status IN ('pending_held', 'confirmed_shared')");
    expect(sql).toContain('CREATE UNIQUE INDEX "service_links_provider_consumer_uniq"');
  });
});
