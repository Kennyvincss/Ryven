CREATE TYPE "public"."agent_mode" AS ENUM('autonomous', 'approval');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."contributor_status" AS ENUM('approved', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."launch_mode" AS ENUM('fixed_supply', 'bonding_curve');--> statement-breakpoint
CREATE TYPE "public"."launch_status" AS ENUM('pending', 'live', 'graduated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('rejected', 'awaiting_approval', 'approved', 'executing', 'confirmed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recipient_policy" AS ENUM('allowlist_only', 'allowlist_or_approval');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "agent_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"instruction_id" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"instruction_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_signers" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"creator_wallet" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"objectives" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"avatar_seed" text NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"paused_reason" text,
	"mode" "agent_mode" DEFAULT 'autonomous' NOT NULL,
	"max_per_tx" bigint NOT NULL,
	"auto_approve_limit" bigint NOT NULL,
	"daily_limit" bigint NOT NULL,
	"categories" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"recipient_policy" "recipient_policy" DEFAULT 'allowlist_only' NOT NULL,
	"signer_pubkey" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "agents_signer_pubkey_unique" UNIQUE("signer_pubkey")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"approver_wallet" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"handle" text NOT NULL,
	"role" text DEFAULT 'community' NOT NULL,
	"status" "contributor_status" DEFAULT 'approved' NOT NULL,
	"activity_score" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"uploader_wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"instruction_id" text,
	"source" text NOT NULL,
	"recipient" text NOT NULL,
	"contributor_id" uuid,
	"amount" bigint NOT NULL,
	"mint" text NOT NULL,
	"category" text NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"status" "payment_status" NOT NULL,
	"policy" jsonb NOT NULL,
	"reserved_at" timestamp with time zone,
	"signature" text,
	"last_valid_block_height" bigint,
	"error" text,
	"executed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"trader" text NOT NULL,
	"sol_amount" bigint NOT NULL,
	"token_amount" bigint NOT NULL,
	"price" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_trades_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mint" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_uri" text,
	"metadata_uri" text NOT NULL,
	"creator_wallet" text NOT NULL,
	"token_program" text NOT NULL,
	"decimals" integer NOT NULL,
	"total_supply" bigint NOT NULL,
	"launch_mode" "launch_mode" NOT NULL,
	"launch_status" "launch_status" DEFAULT 'pending' NOT NULL,
	"launch_signature" text NOT NULL,
	"curve_address" text,
	"website" text,
	"twitter" text,
	"telegram" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_mint_unique" UNIQUE("mint")
);
--> statement-breakpoint
CREATE TABLE "treasuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"address" text NOT NULL,
	"seed" text NOT NULL,
	"owner_wallet" text NOT NULL,
	"mint" text NOT NULL,
	"last_balance" bigint DEFAULT 0 NOT NULL,
	"last_allowance" bigint DEFAULT 0 NOT NULL,
	"last_delegate" text,
	"last_synced_at" timestamp with time zone,
	"total_deposits" bigint DEFAULT 0 NOT NULL,
	"total_spent" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasuries_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "treasuries_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "treasury_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treasury_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"from_wallet" text NOT NULL,
	"amount" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_deposits_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_signers" ADD CONSTRAINT "agent_signers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_trades" ADD CONSTRAINT "token_trades_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasuries" ADD CONSTRAINT "treasuries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_deposits" ADD CONSTRAINT "treasury_deposits_treasury_id_treasuries_id_fk" FOREIGN KEY ("treasury_id") REFERENCES "public"."treasuries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_agent_created_idx" ON "agent_activities" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_agent_created_idx" ON "agent_messages" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agents_creator_idx" ON "agents" USING btree ("creator_wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_agent_wallet_uq" ON "contributors" USING btree ("agent_id","wallet");--> statement-breakpoint
CREATE INDEX "payments_agent_created_idx" ON "payments" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_agent_recipient_idx" ON "payments" USING btree ("agent_id","recipient");--> statement-breakpoint
CREATE INDEX "trades_token_time_idx" ON "token_trades" USING btree ("token_id","block_time");--> statement-breakpoint
CREATE INDEX "tokens_creator_idx" ON "tokens" USING btree ("creator_wallet");--> statement-breakpoint
CREATE INDEX "tokens_created_idx" ON "tokens" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deposits_treasury_idx" ON "treasury_deposits" USING btree ("treasury_id");