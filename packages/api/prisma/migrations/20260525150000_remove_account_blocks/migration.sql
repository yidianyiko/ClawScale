-- DropForeignKey
ALTER TABLE "account_blocks" DROP CONSTRAINT "account_blocks_blocker_account_id_fkey";

-- DropForeignKey
ALTER TABLE "account_blocks" DROP CONSTRAINT "account_blocks_blocked_account_id_fkey";

-- DropTable
DROP TABLE "account_blocks";
