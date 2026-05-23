import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
const migrationPath = join(
  process.cwd(),
  'prisma/migrations/20260522100000_friend_link_shared_reminders/migration.sql',
);
const customerSchedulingRoutesPath = join(process.cwd(), 'src/routes/customer-scheduling-routes.ts');
const internalSchedulingRoutesPath = join(process.cwd(), 'src/routes/internal-scheduling-routes.ts');
const publicUserLinkRoutesPath = join(process.cwd(), 'src/routes/public-user-link-routes.ts');
const userLinkServicePath = join(process.cwd(), 'src/scheduling/user-link-service.ts');
const retiredSchedulingImplementationPaths = [
  join(process.cwd(), 'src/scheduling/availability-service.ts'),
  join(process.cwd(), 'src/scheduling/service-link-service.ts'),
  join(process.cwd(), 'src/scheduling/appointment-service.ts'),
];

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

  it('guards destructive appointment-state retirement', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('Existing appointment scheduling rows block migration');
    expect(sql).toContain('SELECT 1 FROM "service_links"');
    expect(sql).toContain('SELECT 1 FROM "bookable_windows"');
    expect(sql).toContain('SELECT 1 FROM "bookable_window_exclusions"');
    expect(sql).toContain('SELECT 1 FROM "appointment_requests"');
    expect(sql).toContain('SELECT 1 FROM "appointment_events"');
    expect(sql).toContain('SELECT 1 FROM "scheduling_notifications"');
  });

  it('requires product notifications to belong to exactly one request type', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('product_notifications_exactly_one_parent');
    expect(sql).toContain('Prisma cannot represent this cross-column check');
    expect(sql).toContain('"shared_reminder_request_id" IS NOT NULL');
    expect(sql).toContain('"friend_request_id" IS NOT NULL');
  });

  it('stores shared reminder duration as optional interval timing', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const migration = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260524100000_shared_reminder_duration/migration.sql'),
      'utf8',
    );

    expect(schema).toContain('durationMinutes');
    expect(schema).toContain('Int?');
    expect(schema).toContain('@map("duration_minutes")');
    expect(migration).toContain('ALTER TABLE "shared_reminder_requests" ADD COLUMN "duration_minutes" INTEGER');
  });

  it('keeps retired route files detached from deleted scheduling storage', () => {
    const routeSources = [
      readFileSync(customerSchedulingRoutesPath, 'utf8'),
      readFileSync(internalSchedulingRoutesPath, 'utf8'),
      readFileSync(publicUserLinkRoutesPath, 'utf8'),
      readFileSync(userLinkServicePath, 'utf8'),
    ];
    const retiredReferences = [
      'availability-service',
      'appointment-service',
      'service-link-service',
      'db.bookableWindow',
      'db.serviceLink',
      'createOrActivateServiceLink',
      'retryPendingSchedulingNotifications',
    ];

    for (const source of routeSources) {
      for (const retiredReference of retiredReferences) {
        expect(source).not.toContain(retiredReference);
      }
    }
  });

  it('removes retired scheduling implementation files that reference deleted delegates', () => {
    for (const retiredPath of retiredSchedulingImplementationPaths) {
      expect(existsSync(retiredPath)).toBe(false);
    }
  });
});
