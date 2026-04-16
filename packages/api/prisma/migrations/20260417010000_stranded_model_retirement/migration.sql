ALTER TABLE "conversations"
  DROP CONSTRAINT "conversations_backend_id_fkey";

ALTER TABLE "conversations"
  DROP COLUMN "backend_id";

DROP TABLE "workflows";

DROP TYPE "WorkflowType";
