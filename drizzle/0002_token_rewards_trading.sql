CREATE TYPE "public"."asset" AS ENUM('usdc', 'token');--> statement-breakpoint
CREATE TYPE "public"."trade_action" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('rejected', 'awaiting_signature', 'executing', 'confirmed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trading_mode" AS ENUM('off', 'proposal', 'autonomous');--> statement-breakpoint
CREATE TABLE "agent_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"instruction_id" text,
	"mode" "trading_mode" NOT NULL,
	"action" "trade_action" NOT NULL,
	"mint" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"wallet" text NOT NULL,
	"status" "trade_status" NOT NULL,
	"policy" jsonb NOT NULL,
	"reserved_at" timestamp with time zone,
	"signature" text,
	"sol_delta" bigint,
	"error" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_trades_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "agent_trades_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
ALTER TABLE "treasuries" DROP CONSTRAINT "treasuries_agent_id_unique";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "token_max_per_tx" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "token_auto_approve_limit" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "token_daily_limit" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "trading_mode" "trading_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "trade_max_sol" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "trade_daily_sol" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "trade_mints" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "asset" "asset" DEFAULT 'usdc' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "decimals" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "symbol" text DEFAULT 'USDC' NOT NULL;--> statement-breakpoint
ALTER TABLE "treasuries" ADD COLUMN "asset" "asset" DEFAULT 'usdc' NOT NULL;--> statement-breakpoint
ALTER TABLE "treasuries" ADD COLUMN "token_program" text DEFAULT 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' NOT NULL;--> statement-breakpoint
ALTER TABLE "treasuries" ADD COLUMN "decimals" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "treasuries" ADD COLUMN "symbol" text DEFAULT 'USDC' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD CONSTRAINT "agent_trades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_agent_created_idx" ON "agent_trades" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "treasuries_agent_asset_uq" ON "treasuries" USING btree ("agent_id","asset");