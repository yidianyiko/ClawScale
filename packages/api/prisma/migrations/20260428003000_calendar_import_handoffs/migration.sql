-- AlterEnum
ALTER TYPE "CalendarImportRunTriggerSource" ADD VALUE IF NOT EXISTS 'whatsapp_handoff';

-- CreateTable
CREATE TABLE "calendar_import_handoff_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source_customer_id" TEXT NOT NULL,
    "target_customer_id" TEXT,
    "target_identity_id" TEXT,
    "provider" TEXT NOT NULL,
    "identity_type" TEXT NOT NULL,
    "identity_value" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "end_user_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "gateway_conversation_id" TEXT NOT NULL,
    "business_conversation_key" TEXT NOT NULL,
    "target_conversation_id" TEXT,
    "target_character_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_import_handoff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_import_handoff_sessions_token_hash_key" ON "calendar_import_handoff_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "calendar_import_handoff_sessions_status_expires_at_idx" ON "calendar_import_handoff_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "calendar_import_handoff_sessions_source_customer_id_idx" ON "calendar_import_handoff_sessions"("source_customer_id");

-- CreateIndex
CREATE INDEX "calendar_import_handoff_sessions_target_customer_id_idx" ON "calendar_import_handoff_sessions"("target_customer_id");
