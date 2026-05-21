-- CreateEnum
CREATE TYPE "UserLinkStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "LinkSessionStatus" AS ENUM ('opened', 'claimed', 'abandoned');

-- CreateEnum
CREATE TYPE "ServiceLinkStatus" AS ENUM ('active', 'blocked', 'removed');

-- CreateEnum
CREATE TYPE "SchedulingCapability" AS ENUM ('appointment_request');

-- CreateEnum
CREATE TYPE "BookableWindowStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "BookableWindowType" AS ENUM ('weekly', 'once');

-- CreateEnum
CREATE TYPE "AppointmentRequestStatus" AS ENUM ('pending_held', 'confirmed_shared', 'released');

-- CreateEnum
CREATE TYPE "AppointmentReleaseReason" AS ENUM ('rejected_by_a', 'cancelled_by_a', 'cancelled_by_b');

-- CreateEnum
CREATE TYPE "AppointmentActorRole" AS ENUM ('provider', 'consumer', 'system');

-- CreateEnum
CREATE TYPE "SchedulingNotificationStatus" AS ENUM ('pending_delivery', 'delivered', 'failed');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "tagline" VARCHAR(120),
ADD COLUMN "avatar_url" TEXT;

-- CreateTable
CREATE TABLE "user_links" (
    "id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "UserLinkStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_link_id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "consumer_account_id" TEXT,
    "status" "LinkSessionStatus" NOT NULL DEFAULT 'opened',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "abandoned_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_links" (
    "id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "consumer_account_id" TEXT NOT NULL,
    "status" "ServiceLinkStatus" NOT NULL DEFAULT 'active',
    "capabilities" "SchedulingCapability"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "blocked_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookable_windows" (
    "id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "capability" "SchedulingCapability" NOT NULL DEFAULT 'appointment_request',
    "type" "BookableWindowType" NOT NULL,
    "rule" JSONB NOT NULL,
    "rule_fingerprint" TEXT NOT NULL,
    "status" "BookableWindowStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookable_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookable_window_exclusions" (
    "id" TEXT NOT NULL,
    "bookable_window_id" TEXT NOT NULL,
    "instance_start" TIMESTAMP(3) NOT NULL,
    "instance_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookable_window_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_requests" (
    "id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "consumer_account_id" TEXT NOT NULL,
    "service_link_id" TEXT NOT NULL,
    "bookable_window_id" TEXT NOT NULL,
    "instance_start" TIMESTAMP(3) NOT NULL,
    "instance_end" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "AppointmentRequestStatus" NOT NULL DEFAULT 'pending_held',
    "release_reason" "AppointmentReleaseReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "from_state" "AppointmentRequestStatus",
    "to_state" "AppointmentRequestStatus" NOT NULL,
    "actor_account_id" TEXT NOT NULL,
    "actor_role" "AppointmentActorRole" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_notifications" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "recipient_account_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SchedulingNotificationStatus" NOT NULL DEFAULT 'pending_delivery',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduling_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_links_code_key" ON "user_links"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_links_id_provider_account_id_key" ON "user_links"("id", "provider_account_id");

-- CreateIndex
CREATE INDEX "user_links_provider_account_id_idx" ON "user_links"("provider_account_id");

-- CreateIndex
CREATE INDEX "user_links_status_idx" ON "user_links"("status");

-- CreateIndex
CREATE UNIQUE INDEX "link_sessions_token_hash_key" ON "link_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "link_sessions_provider_account_id_status_idx" ON "link_sessions"("provider_account_id", "status");

-- CreateIndex
CREATE INDEX "link_sessions_consumer_account_id_idx" ON "link_sessions"("consumer_account_id");

-- CreateIndex
CREATE INDEX "link_sessions_expires_at_idx" ON "link_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "service_links_provider_account_id_status_idx" ON "service_links"("provider_account_id", "status");

-- CreateIndex
CREATE INDEX "service_links_consumer_account_id_status_idx" ON "service_links"("consumer_account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_links_id_provider_account_id_consumer_account_id_key" ON "service_links"("id", "provider_account_id", "consumer_account_id");

-- CreateIndex
CREATE INDEX "bookable_windows_provider_account_id_status_idx" ON "bookable_windows"("provider_account_id", "status");

-- CreateIndex
CREATE INDEX "bookable_windows_rule_fingerprint_idx" ON "bookable_windows"("rule_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "bookable_windows_id_provider_account_id_key" ON "bookable_windows"("id", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookable_window_exclusions_bookable_window_id_instance_start_instance_end_key" ON "bookable_window_exclusions"("bookable_window_id", "instance_start", "instance_end");

-- CreateIndex
CREATE INDEX "appointment_requests_provider_account_id_status_idx" ON "appointment_requests"("provider_account_id", "status");

-- CreateIndex
CREATE INDEX "appointment_requests_consumer_account_id_status_idx" ON "appointment_requests"("consumer_account_id", "status");

-- CreateIndex
CREATE INDEX "appointment_requests_bookable_window_id_instance_start_instance_end_idx" ON "appointment_requests"("bookable_window_id", "instance_start", "instance_end");

-- CreateIndex
CREATE INDEX "appointment_events_appointment_id_created_at_idx" ON "appointment_events"("appointment_id", "created_at");

-- CreateIndex
CREATE INDEX "appointment_events_actor_account_id_created_at_idx" ON "appointment_events"("actor_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduling_notifications_idempotency_key_key" ON "scheduling_notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "scheduling_notifications_status_created_at_idx" ON "scheduling_notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "scheduling_notifications_recipient_account_id_created_at_idx" ON "scheduling_notifications"("recipient_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_links_one_active_per_account"
ON "user_links" ("provider_account_id")
WHERE status = 'active';

-- CreateIndex
CREATE UNIQUE INDEX "service_links_provider_consumer_uniq"
ON "service_links" ("provider_account_id", "consumer_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookable_windows_active_fingerprint_uniq"
ON "bookable_windows" ("provider_account_id", "capability", "rule_fingerprint")
WHERE status = 'active';

-- CreateIndex
CREATE UNIQUE INDEX "appointment_instance_occupancy_uniq"
ON "appointment_requests" (
  "provider_account_id",
  "bookable_window_id",
  "instance_start",
  "instance_end"
)
WHERE status IN ('pending_held', 'confirmed_shared');

-- AddForeignKey
ALTER TABLE "user_links" ADD CONSTRAINT "user_links_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_sessions" ADD CONSTRAINT "link_sessions_user_link_id_provider_account_id_fkey" FOREIGN KEY ("user_link_id", "provider_account_id") REFERENCES "user_links"("id", "provider_account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_links" ADD CONSTRAINT "service_links_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_links" ADD CONSTRAINT "service_links_consumer_account_id_fkey" FOREIGN KEY ("consumer_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookable_windows" ADD CONSTRAINT "bookable_windows_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookable_window_exclusions" ADD CONSTRAINT "bookable_window_exclusions_bookable_window_id_fkey" FOREIGN KEY ("bookable_window_id") REFERENCES "bookable_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_consumer_account_id_fkey" FOREIGN KEY ("consumer_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_service_link_id_provider_account_id_consumer_account_id_fkey" FOREIGN KEY ("service_link_id", "provider_account_id", "consumer_account_id") REFERENCES "service_links"("id", "provider_account_id", "consumer_account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_bookable_window_id_provider_account_id_fkey" FOREIGN KEY ("bookable_window_id", "provider_account_id") REFERENCES "bookable_windows"("id", "provider_account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling_notifications" ADD CONSTRAINT "scheduling_notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling_notifications" ADD CONSTRAINT "scheduling_notifications_recipient_account_id_fkey" FOREIGN KEY ("recipient_account_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
