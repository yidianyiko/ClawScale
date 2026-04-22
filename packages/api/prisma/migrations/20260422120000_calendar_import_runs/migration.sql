-- CreateEnum
CREATE TYPE "CalendarImportRunProvider" AS ENUM ('google_calendar');

-- CreateEnum
CREATE TYPE "CalendarImportRunStatus" AS ENUM ('authorizing', 'importing', 'succeeded', 'succeeded_with_errors', 'failed');

-- CreateEnum
CREATE TYPE "CalendarImportRunTriggerSource" AS ENUM ('manual_web', 'whatsapp_claim_redirect');

-- CreateTable
CREATE TABLE "calendar_import_runs" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "target_conversation_id" TEXT NOT NULL,
    "target_character_id" TEXT NOT NULL,
    "provider" "CalendarImportRunProvider" NOT NULL,
    "trigger_source" "CalendarImportRunTriggerSource" NOT NULL,
    "status" "CalendarImportRunStatus" NOT NULL,
    "provider_account_email" TEXT,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_import_runs_customer_id_identity_id_started_at_id_idx" ON "calendar_import_runs"("customer_id", "identity_id", "started_at", "id");

-- AddForeignKey
ALTER TABLE "calendar_import_runs" ADD CONSTRAINT "calendar_import_runs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_import_runs" ADD CONSTRAINT "calendar_import_runs_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
