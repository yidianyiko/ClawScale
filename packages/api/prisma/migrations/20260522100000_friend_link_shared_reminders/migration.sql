-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "SharedReminderRequestStatus" AS ENUM ('pending_invitee_confirmation', 'accepted', 'rejected', 'expired', 'cancelled', 'invalidated');

-- CreateEnum
CREATE TYPE "SharedReminderProjectionRole" AS ENUM ('requester', 'invitee');

-- CreateEnum
CREATE TYPE "SharedReminderActorRole" AS ENUM ('requester', 'invitee', 'system');

-- CreateEnum
CREATE TYPE "ProductNotificationStatus" AS ENUM ('pending_delivery', 'delivered', 'failed');

-- Preflight
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "service_links")
    OR EXISTS (SELECT 1 FROM "bookable_windows")
    OR EXISTS (SELECT 1 FROM "bookable_window_exclusions")
    OR EXISTS (SELECT 1 FROM "appointment_requests")
    OR EXISTS (SELECT 1 FROM "appointment_events")
    OR EXISTS (SELECT 1 FROM "scheduling_notifications")
  THEN
    RAISE EXCEPTION 'Existing appointment scheduling rows block migration; clear retired scheduling tables before applying friend-link shared-reminder schema.';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "service_links" DROP CONSTRAINT "service_links_provider_account_id_fkey";

-- DropForeignKey
ALTER TABLE "service_links" DROP CONSTRAINT "service_links_consumer_account_id_fkey";

-- DropForeignKey
ALTER TABLE "bookable_windows" DROP CONSTRAINT "bookable_windows_provider_account_id_fkey";

-- DropForeignKey
ALTER TABLE "bookable_window_exclusions" DROP CONSTRAINT "bookable_window_exclusions_bookable_window_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_requests" DROP CONSTRAINT "appointment_requests_provider_account_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_requests" DROP CONSTRAINT "appointment_requests_consumer_account_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_requests" DROP CONSTRAINT "appointment_requests_service_link_id_provider_account_id_consumer_account_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_requests" DROP CONSTRAINT "appointment_requests_bookable_window_id_provider_account_id_fkey";

-- DropForeignKey
ALTER TABLE "appointment_events" DROP CONSTRAINT "appointment_events_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "scheduling_notifications" DROP CONSTRAINT "scheduling_notifications_appointment_id_fkey";

-- DropForeignKey
ALTER TABLE "scheduling_notifications" DROP CONSTRAINT "scheduling_notifications_recipient_account_id_fkey";

-- DropTable
DROP TABLE "service_links";

-- DropTable
DROP TABLE "bookable_windows";

-- DropTable
DROP TABLE "bookable_window_exclusions";

-- DropTable
DROP TABLE "appointment_requests";

-- DropTable
DROP TABLE "appointment_events";

-- DropTable
DROP TABLE "scheduling_notifications";

-- DropEnum
DROP TYPE "ServiceLinkStatus";

-- DropEnum
DROP TYPE "SchedulingCapability";

-- DropEnum
DROP TYPE "BookableWindowStatus";

-- DropEnum
DROP TYPE "BookableWindowType";

-- DropEnum
DROP TYPE "AppointmentRequestStatus";

-- DropEnum
DROP TYPE "AppointmentReleaseReason";

-- DropEnum
DROP TYPE "AppointmentActorRole";

-- DropEnum
DROP TYPE "SchedulingNotificationStatus";

-- CreateTable
CREATE TABLE "friend_requests" (
    "id" TEXT NOT NULL,
    "requester_account_id" TEXT NOT NULL,
    "target_account_id" TEXT NOT NULL,
    "link_session_id" TEXT,
    "message" VARCHAR(500),
    "idempotency_key" TEXT,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'pending',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friend_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "account_a_id" TEXT NOT NULL,
    "account_b_id" TEXT NOT NULL,
    "friend_request_id" TEXT,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'active',
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_blocks" (
    "id" TEXT NOT NULL,
    "blocker_account_id" TEXT NOT NULL,
    "blocked_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_reminder_requests" (
    "id" TEXT NOT NULL,
    "requester_account_id" TEXT NOT NULL,
    "invitee_account_id" TEXT NOT NULL,
    "friendship_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "fire_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "status" "SharedReminderRequestStatus" NOT NULL DEFAULT 'pending_invitee_confirmation',
    "requester_reminder_id" TEXT,
    "invitee_reminder_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_reminder_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_reminder_events" (
    "id" TEXT NOT NULL,
    "shared_reminder_request_id" TEXT NOT NULL,
    "from_state" "SharedReminderRequestStatus",
    "to_state" "SharedReminderRequestStatus" NOT NULL,
    "actor_account_id" TEXT,
    "actor_role" "SharedReminderActorRole" NOT NULL,
    "idempotency_key" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_reminder_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_projections" (
    "id" TEXT NOT NULL,
    "shared_reminder_request_id" TEXT NOT NULL,
    "owner_account_id" TEXT NOT NULL,
    "runtime_reminder_id" TEXT NOT NULL,
    "role" "SharedReminderProjectionRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_notifications" (
    "id" TEXT NOT NULL,
    "shared_reminder_request_id" TEXT,
    "friend_request_id" TEXT,
    "recipient_account_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ProductNotificationStatus" NOT NULL DEFAULT 'pending_delivery',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_notifications_pkey" PRIMARY KEY ("id")
);

-- AddConstraint
ALTER TABLE "product_notifications" ADD CONSTRAINT "product_notifications_one_parent_request_chk" CHECK (
    (("shared_reminder_request_id" IS NOT NULL) AND ("friend_request_id" IS NULL))
    OR (("shared_reminder_request_id" IS NULL) AND ("friend_request_id" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "friend_requests_requester_account_id_status_idx" ON "friend_requests"("requester_account_id", "status");

-- CreateIndex
CREATE INDEX "friend_requests_target_account_id_status_idx" ON "friend_requests"("target_account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "friend_requests_requester_account_id_target_account_id_idem_key" ON "friend_requests"("requester_account_id", "target_account_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "friendships_account_a_id_status_idx" ON "friendships"("account_a_id", "status");

-- CreateIndex
CREATE INDEX "friendships_account_b_id_status_idx" ON "friendships"("account_b_id", "status");

-- CreateIndex
CREATE INDEX "account_blocks_blocker_account_id_idx" ON "account_blocks"("blocker_account_id");

-- CreateIndex
CREATE INDEX "account_blocks_blocked_account_id_idx" ON "account_blocks"("blocked_account_id");

-- CreateIndex
CREATE INDEX "shared_reminder_requests_requester_account_id_status_idx" ON "shared_reminder_requests"("requester_account_id", "status");

-- CreateIndex
CREATE INDEX "shared_reminder_requests_invitee_account_id_status_idx" ON "shared_reminder_requests"("invitee_account_id", "status");

-- CreateIndex
CREATE INDEX "shared_reminder_requests_fire_at_status_idx" ON "shared_reminder_requests"("fire_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shared_reminder_requests_requester_account_id_invitee_accou_key" ON "shared_reminder_requests"("requester_account_id", "invitee_account_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "shared_reminder_events_idempotency_key_key" ON "shared_reminder_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "shared_reminder_events_shared_reminder_request_id_created_a_idx" ON "shared_reminder_events"("shared_reminder_request_id", "created_at");

-- CreateIndex
CREATE INDEX "reminder_projections_owner_account_id_idx" ON "reminder_projections"("owner_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_projections_shared_reminder_request_id_role_key" ON "reminder_projections"("shared_reminder_request_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "product_notifications_idempotency_key_key" ON "product_notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "product_notifications_status_created_at_idx" ON "product_notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "product_notifications_recipient_account_id_created_at_idx" ON "product_notifications"("recipient_account_id", "created_at");

-- CreateIndex
DROP INDEX IF EXISTS "user_links_one_active_per_account";
CREATE UNIQUE INDEX "user_links_one_active_per_account"
  ON "user_links" ("provider_account_id")
  WHERE status = 'active';

-- CreateIndex
CREATE UNIQUE INDEX "friend_requests_one_pending_pair"
  ON "friend_requests" ("requester_account_id", "target_account_id")
  WHERE status = 'pending';

-- CreateIndex
CREATE UNIQUE INDEX "friendships_one_active_pair"
  ON "friendships" (LEAST("account_a_id", "account_b_id"), GREATEST("account_a_id", "account_b_id"))
  WHERE status = 'active';

-- CreateIndex
CREATE UNIQUE INDEX "account_blocks_direction_uniq"
  ON "account_blocks" ("blocker_account_id", "blocked_account_id");

-- AddForeignKey
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_requester_account_id_fkey" FOREIGN KEY ("requester_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_target_account_id_fkey" FOREIGN KEY ("target_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_link_session_id_fkey" FOREIGN KEY ("link_session_id") REFERENCES "link_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_account_a_id_fkey" FOREIGN KEY ("account_a_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_account_b_id_fkey" FOREIGN KEY ("account_b_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_friend_request_id_fkey" FOREIGN KEY ("friend_request_id") REFERENCES "friend_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_blocks" ADD CONSTRAINT "account_blocks_blocker_account_id_fkey" FOREIGN KEY ("blocker_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_blocks" ADD CONSTRAINT "account_blocks_blocked_account_id_fkey" FOREIGN KEY ("blocked_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_reminder_requests" ADD CONSTRAINT "shared_reminder_requests_requester_account_id_fkey" FOREIGN KEY ("requester_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_reminder_requests" ADD CONSTRAINT "shared_reminder_requests_invitee_account_id_fkey" FOREIGN KEY ("invitee_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_reminder_requests" ADD CONSTRAINT "shared_reminder_requests_friendship_id_fkey" FOREIGN KEY ("friendship_id") REFERENCES "friendships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_reminder_events" ADD CONSTRAINT "shared_reminder_events_shared_reminder_request_id_fkey" FOREIGN KEY ("shared_reminder_request_id") REFERENCES "shared_reminder_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_projections" ADD CONSTRAINT "reminder_projections_shared_reminder_request_id_fkey" FOREIGN KEY ("shared_reminder_request_id") REFERENCES "shared_reminder_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_projections" ADD CONSTRAINT "reminder_projections_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_notifications" ADD CONSTRAINT "product_notifications_shared_reminder_request_id_fkey" FOREIGN KEY ("shared_reminder_request_id") REFERENCES "shared_reminder_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_notifications" ADD CONSTRAINT "product_notifications_friend_request_id_fkey" FOREIGN KEY ("friend_request_id") REFERENCES "friend_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_notifications" ADD CONSTRAINT "product_notifications_recipient_account_id_fkey" FOREIGN KEY ("recipient_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
