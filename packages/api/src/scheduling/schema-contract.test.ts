import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
const migrationPath = join(
  process.cwd(),
  'prisma/migrations/20260522100000_friend_link_shared_reminders/migration.sql',
);

describe('friend-link and shared-reminder schema contract', () => {
  it('declares first-version product-state models', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('model UserLink');
    expect(schema).toContain('model LinkSession');
    expect(schema).toContain('model FriendRequest');
    expect(schema).toContain('model Friendship');
    expect(schema).toContain('model AccountBlock');
    expect(schema).toContain('model SharedReminderRequest');
    expect(schema).toContain('model SharedReminderEvent');
    expect(schema).toContain('model ReminderProjection');
    expect(schema).toContain('model ProductNotification');
  });

  it('removes appointment-only product models', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).not.toContain('model ServiceLink');
    expect(schema).not.toContain('model BookableWindow');
    expect(schema).not.toContain('model BookableWindowExclusion');
    expect(schema).not.toContain('model AppointmentRequest');
    expect(schema).not.toContain('model AppointmentEvent');
    expect(schema).not.toContain('enum AppointmentRequestStatus');
    expect(schema).not.toContain('enum BookableWindowStatus');
  });

  it('keeps database constraints for active links and account pairs', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX "user_links_one_active_per_account"');
    expect(sql).toContain("WHERE status = 'active'");
    expect(sql).toContain('CREATE UNIQUE INDEX "friend_requests_one_pending_pair"');
    expect(sql).toContain("WHERE status = 'pending'");
    expect(sql).toContain('CREATE UNIQUE INDEX "friendships_one_active_pair"');
    expect(sql).toContain("WHERE status = 'active'");
    expect(sql).toContain('CREATE UNIQUE INDEX "account_blocks_direction_uniq"');
  });
});
