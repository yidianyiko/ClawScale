import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const tenantPlanEnum = pgEnum('tenant_plan', ['starter', 'business', 'enterprise']);
export const userRoleEnum = pgEnum('user_role', ['admin', 'member', 'viewer']);
export const channelStatusEnum = pgEnum('channel_status', ['connected', 'disconnected', 'pending', 'error']);
export const channelTypeEnum = pgEnum('channel_type', [
  'whatsapp',
  'telegram',
  'slack',
  'discord',
  'instagram',
  'facebook',
  'line',
  'signal',
  'teams',
  'matrix',
  'web',
]);

// ─── Tenants ──────────────────────────────────────────────────────────────────

export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    plan: tenantPlanEnum('plan').notNull().default('starter'),
    /** JSON blob for persona name/prompt, feature flags, limits */
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenants_slug_idx').on(t.slug)],
);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('member'),
    isActive: boolean('is_active').notNull().default(true),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_tenant_email_idx').on(t.tenantId, t.email),
    index('users_tenant_idx').on(t.tenantId),
  ],
);

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Opaque refresh token (hashed) */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_tenant_idx').on(t.tenantId)],
);

// ─── Channels ─────────────────────────────────────────────────────────────────

export const channels = pgTable(
  'channels',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: channelTypeEnum('type').notNull(),
    name: text('name').notNull(),
    status: channelStatusEnum('status').notNull().default('disconnected'),
    /** Encrypted/sanitised config blob (API tokens etc.) */
    config: jsonb('config').notNull().default({}),
    /** Port of the OpenClaw gateway process for this channel, if running */
    gatewayPort: integer('gateway_port'),
    /** PID of the running OpenClaw process, if any */
    gatewayPid: integer('gateway_pid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('channels_tenant_idx').on(t.tenantId)],
);

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_tenant_idx').on(t.tenantId)],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  channels: many(channels),
  sessions: many(sessions),
  auditLogs: many(auditLogs),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  sessions: many(sessions),
}));

export const channelsRelations = relations(channels, ({ one }) => ({
  tenant: one(tenants, { fields: [channels.tenantId], references: [tenants.id] }),
}));
