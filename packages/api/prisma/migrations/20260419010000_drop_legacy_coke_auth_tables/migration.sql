DROP TABLE IF EXISTS "verify_tokens";

ALTER TABLE "subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_coke_account_id_fkey";

DROP INDEX IF EXISTS "subscriptions_coke_account_id_idx";
DROP INDEX IF EXISTS "subscriptions_coke_account_id_expires_at_idx";

ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "coke_account_id";

ALTER TABLE "clawscale_users"
  DROP CONSTRAINT IF EXISTS "clawscale_users_coke_account_id_fkey";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "clawscale_users" AS cu
    LEFT JOIN "customers" AS c ON c."id" = cu."coke_account_id"
    WHERE c."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot retire legacy coke auth tables: clawscale_users.coke_account_id has no matching customers.id';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clawscale_users_coke_account_id_fkey'
  ) THEN
    ALTER TABLE "clawscale_users"
      ADD CONSTRAINT "clawscale_users_coke_account_id_fkey"
      FOREIGN KEY ("coke_account_id") REFERENCES "customers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DROP TABLE IF EXISTS "coke_accounts";

DROP TYPE IF EXISTS "VerifyTokenType";
DROP TYPE IF EXISTS "CokeAccountStatus";
