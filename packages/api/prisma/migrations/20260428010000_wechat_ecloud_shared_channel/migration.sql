ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'wechat_ecloud';

CREATE TABLE IF NOT EXISTS "inbound_webhook_receipts" (
  "id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbound_webhook_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbound_webhook_receipts_provider_idempotency_key_key"
  ON "inbound_webhook_receipts"("provider", "idempotency_key");

CREATE INDEX IF NOT EXISTS "inbound_webhook_receipts_channel_id_created_at_idx"
  ON "inbound_webhook_receipts"("channel_id", "created_at");

ALTER TABLE "inbound_webhook_receipts"
  ADD CONSTRAINT "inbound_webhook_receipts_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
