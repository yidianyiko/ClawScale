-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('connected', 'disconnected', 'pending', 'error', 'archived');

-- CreateEnum
CREATE TYPE "ChannelScope" AS ENUM ('tenant_shared', 'personal');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('whatsapp', 'telegram', 'slack', 'discord', 'instagram', 'facebook', 'line', 'signal', 'teams', 'matrix', 'web', 'wechat_work', 'whatsapp_business', 'wechat_personal');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('script_js', 'script_python', 'script_shell', 'n8n', 'pulse_editor');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "EndUserStatus" AS ENUM ('allowed', 'blocked');

-- CreateEnum
CREATE TYPE "CokeAccountStatus" AS ENUM ('normal', 'suspended');

-- CreateEnum
CREATE TYPE "VerifyTokenType" AS ENUM ('email_verify', 'password_reset');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "scope" "ChannelScope" NOT NULL DEFAULT 'tenant_shared',
    "owner_clawscale_user_id" TEXT,
    "active_lifecycle_key" TEXT,
    "name" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'disconnected',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "end_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "EndUserStatus" NOT NULL DEFAULT 'allowed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "linked_to" TEXT,
    "clawscale_user_id" TEXT,

    CONSTRAINT "end_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clawscale_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "coke_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clawscale_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coke_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "status" "CokeAccountStatus" NOT NULL DEFAULT 'normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coke_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "coke_account_id" TEXT NOT NULL,
    "stripe_session_id" TEXT NOT NULL,
    "amount_paid" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verify_tokens" (
    "id" TEXT NOT NULL,
    "coke_account_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "type" "VerifyTokenType" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verify_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "end_user_backends" (
    "end_user_id" TEXT NOT NULL,
    "backend_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "end_user_backends_pkey" PRIMARY KEY ("end_user_id","backend_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "end_user_id" TEXT NOT NULL,
    "clawscale_user_id" TEXT,
    "backend_id" TEXT,
    "business_conversation_key" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_routes" (
    "tenant_id" TEXT NOT NULL,
    "coke_account_id" TEXT NOT NULL,
    "business_conversation_key" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "end_user_id" TEXT NOT NULL,
    "external_end_user_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("coke_account_id","business_conversation_key")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "backend_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_backends" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ai_backends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "WorkflowType" NOT NULL,
    "code" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "end_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "members_tenant_id_idx" ON "members"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_tenant_id_email_key" ON "members"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "sessions_member_id_idx" ON "sessions"("member_id");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "channels_active_lifecycle_key_key" ON "channels"("active_lifecycle_key");

-- CreateIndex
CREATE INDEX "channels_tenant_id_idx" ON "channels"("tenant_id");

-- CreateIndex
CREATE INDEX "channels_owner_clawscale_user_id_idx" ON "channels"("owner_clawscale_user_id");

-- CreateIndex
CREATE INDEX "end_users_clawscale_user_id_idx" ON "end_users"("clawscale_user_id");

-- CreateIndex
CREATE INDEX "end_users_tenant_id_idx" ON "end_users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "end_users_tenant_id_channel_id_external_id_key" ON "end_users"("tenant_id", "channel_id", "external_id");

-- CreateIndex
CREATE INDEX "clawscale_users_tenant_id_idx" ON "clawscale_users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "clawscale_users_tenant_id_coke_account_id_key" ON "clawscale_users"("tenant_id", "coke_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "clawscale_users_coke_account_id_key" ON "clawscale_users"("coke_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "coke_accounts_email_key" ON "coke_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_session_id_key" ON "subscriptions"("stripe_session_id");

-- CreateIndex
CREATE INDEX "subscriptions_coke_account_id_idx" ON "subscriptions"("coke_account_id");

-- CreateIndex
CREATE INDEX "subscriptions_coke_account_id_expires_at_idx" ON "subscriptions"("coke_account_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verify_tokens_token_hash_key" ON "verify_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verify_tokens_coke_account_id_idx" ON "verify_tokens"("coke_account_id");

-- CreateIndex
CREATE INDEX "end_user_backends_end_user_id_idx" ON "end_user_backends"("end_user_id");

-- CreateIndex
CREATE INDEX "end_user_backends_backend_id_idx" ON "end_user_backends"("backend_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_idx" ON "conversations"("tenant_id");

-- CreateIndex
CREATE INDEX "conversations_end_user_id_idx" ON "conversations"("end_user_id");

-- CreateIndex
CREATE INDEX "conversations_clawscale_user_id_idx" ON "conversations"("clawscale_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_clawscale_user_id_business_conversation_key_key" ON "conversations"("clawscale_user_id", "business_conversation_key");

-- CreateIndex
CREATE INDEX "delivery_routes_tenant_id_idx" ON "delivery_routes"("tenant_id");

-- CreateIndex
CREATE INDEX "delivery_routes_channel_id_idx" ON "delivery_routes"("channel_id");

-- CreateIndex
CREATE INDEX "delivery_routes_end_user_id_idx" ON "delivery_routes"("end_user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "outbound_deliveries_tenant_id_idx" ON "outbound_deliveries"("tenant_id");

-- CreateIndex
CREATE INDEX "outbound_deliveries_channel_id_idx" ON "outbound_deliveries"("channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_deliveries_idempotency_key_key" ON "outbound_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_backends_tenant_id_idx" ON "ai_backends"("tenant_id");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_idx" ON "workflows"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_codes_code_key" ON "link_codes"("code");

-- CreateIndex
CREATE INDEX "link_codes_code_used_idx" ON "link_codes"("code", "used");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_owner_clawscale_user_id_fkey" FOREIGN KEY ("owner_clawscale_user_id") REFERENCES "clawscale_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_linked_to_fkey" FOREIGN KEY ("linked_to") REFERENCES "end_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_clawscale_user_id_fkey" FOREIGN KEY ("clawscale_user_id") REFERENCES "clawscale_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clawscale_users" ADD CONSTRAINT "clawscale_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clawscale_users" ADD CONSTRAINT "clawscale_users_coke_account_id_fkey" FOREIGN KEY ("coke_account_id") REFERENCES "coke_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_coke_account_id_fkey" FOREIGN KEY ("coke_account_id") REFERENCES "coke_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verify_tokens" ADD CONSTRAINT "verify_tokens_coke_account_id_fkey" FOREIGN KEY ("coke_account_id") REFERENCES "coke_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_user_backends" ADD CONSTRAINT "end_user_backends_end_user_id_fkey" FOREIGN KEY ("end_user_id") REFERENCES "end_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_user_backends" ADD CONSTRAINT "end_user_backends_backend_id_fkey" FOREIGN KEY ("backend_id") REFERENCES "ai_backends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_end_user_id_fkey" FOREIGN KEY ("end_user_id") REFERENCES "end_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clawscale_user_id_fkey" FOREIGN KEY ("clawscale_user_id") REFERENCES "clawscale_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_backend_id_fkey" FOREIGN KEY ("backend_id") REFERENCES "ai_backends"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_end_user_id_fkey" FOREIGN KEY ("end_user_id") REFERENCES "end_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_coke_account_id_fkey" FOREIGN KEY ("coke_account_id") REFERENCES "clawscale_users"("coke_account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_backend_id_fkey" FOREIGN KEY ("backend_id") REFERENCES "ai_backends"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_backends" ADD CONSTRAINT "ai_backends_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_codes" ADD CONSTRAINT "link_codes_end_user_id_fkey" FOREIGN KEY ("end_user_id") REFERENCES "end_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
