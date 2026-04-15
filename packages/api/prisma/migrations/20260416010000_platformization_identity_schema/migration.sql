CREATE TYPE "IdentityClaimStatus" AS ENUM ('active', 'unclaimed', 'pending');
CREATE TYPE "CustomerKind" AS ENUM ('personal', 'organization');
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'member', 'viewer');
CREATE TYPE "AgentBindingProvisionStatus" AS ENUM ('pending', 'ready', 'error');
CREATE TYPE "ChannelOwnershipKind" AS ENUM ('customer', 'shared');

CREATE TABLE "admin_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mfa_secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "identities" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "claim_status" "IdentityClaimStatus" NOT NULL DEFAULT 'unclaimed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "kind" "CustomerKind" NOT NULL DEFAULT 'personal',
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_bindings" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "provision_status" "AgentBindingProvisionStatus" NOT NULL DEFAULT 'pending',
    "provision_attempts" INTEGER NOT NULL DEFAULT 0,
    "provision_last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "channels"
    ADD COLUMN "ownership_kind" "ChannelOwnershipKind" NOT NULL DEFAULT 'customer',
    ADD COLUMN "customer_id" TEXT,
    ADD COLUMN "agent_id" TEXT;

ALTER TABLE "channels"
    ADD CONSTRAINT "channels_ownership_kind_check"
    CHECK (
        ("ownership_kind" = 'customer'::"ChannelOwnershipKind" AND "customer_id" IS NOT NULL)
        OR
        ("ownership_kind" = 'shared'::"ChannelOwnershipKind" AND "customer_id" IS NULL AND "agent_id" IS NOT NULL)
    );

CREATE UNIQUE INDEX "admin_accounts_email_key" ON "admin_accounts"("email");
CREATE UNIQUE INDEX "identities_email_key" ON "identities"("email");
CREATE UNIQUE INDEX "memberships_identity_id_customer_id_key" ON "memberships"("identity_id", "customer_id");
CREATE UNIQUE INDEX "agents_slug_key" ON "agents"("slug");
CREATE UNIQUE INDEX "agent_bindings_customer_id_agent_id_key" ON "agent_bindings"("customer_id", "agent_id");
CREATE UNIQUE INDEX "external_identities_provider_external_id_key" ON "external_identities"("provider", "external_id");
CREATE UNIQUE INDEX "agents_is_default_true_key" ON "agents" ("is_default") WHERE "is_default" = true;
CREATE UNIQUE INDEX "channels_customer_kind_active_key" ON "channels" ("customer_id", "type") WHERE "customer_id" IS NOT NULL AND "status" <> 'archived'::"ChannelStatus";

CREATE INDEX "memberships_identity_id_idx" ON "memberships"("identity_id");
CREATE INDEX "memberships_customer_id_idx" ON "memberships"("customer_id");
CREATE INDEX "agent_bindings_customer_id_idx" ON "agent_bindings"("customer_id");
CREATE INDEX "agent_bindings_agent_id_idx" ON "agent_bindings"("agent_id");
CREATE INDEX "external_identities_identity_id_idx" ON "external_identities"("identity_id");
CREATE INDEX "external_identities_channel_id_idx" ON "external_identities"("channel_id");
CREATE INDEX "channels_customer_id_idx" ON "channels"("customer_id");
CREATE INDEX "channels_agent_id_idx" ON "channels"("agent_id");

ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_identity_id_fkey"
    FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_bindings"
    ADD CONSTRAINT "agent_bindings_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_bindings"
    ADD CONSTRAINT "agent_bindings_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_identities"
    ADD CONSTRAINT "external_identities_identity_id_fkey"
    FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_identities"
    ADD CONSTRAINT "external_identities_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "channels"
    ADD CONSTRAINT "channels_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "channels"
    ADD CONSTRAINT "channels_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
