DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ParkedInboundStatus') THEN
        CREATE TYPE "ParkedInboundStatus" AS ENUM ('queued', 'processing', 'drained', 'failed');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "parked_inbounds" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "identity_type" TEXT NOT NULL,
    "identity_value" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ParkedInboundStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "drained_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parked_inbounds_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'parked_inbounds_channel_id_fkey'
    ) THEN
        ALTER TABLE "parked_inbounds"
            ADD CONSTRAINT "parked_inbounds_channel_id_fkey"
            FOREIGN KEY ("channel_id") REFERENCES "channels"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "parked_inbounds_channel_id_status_created_at_idx"
    ON "parked_inbounds"("channel_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "parked_inbounds_status_created_at_idx"
    ON "parked_inbounds"("status", "created_at");

CREATE INDEX IF NOT EXISTS "parked_inbounds_provider_identity_type_identity_value_idx"
    ON "parked_inbounds"("provider", "identity_type", "identity_value");
