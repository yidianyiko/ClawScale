ALTER TABLE "subscriptions"
  ADD COLUMN "customer_id" TEXT;

UPDATE "subscriptions"
SET "customer_id" = "coke_account_id"
WHERE "customer_id" IS NULL;

ALTER TABLE "subscriptions"
  ALTER COLUMN "customer_id" SET NOT NULL;

CREATE INDEX "subscriptions_customer_id_idx" ON "subscriptions"("customer_id");
CREATE INDEX "subscriptions_customer_id_expires_at_idx" ON "subscriptions"("customer_id", "expires_at");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
