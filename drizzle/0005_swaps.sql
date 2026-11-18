ALTER TYPE "public"."trade_action" ADD VALUE 'swap';--> statement-breakpoint
ALTER TABLE "agent_trades" ADD COLUMN "input_mint" text;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD COLUMN "input_amount" bigint;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD COLUMN "input_decimals" integer;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD COLUMN "output_decimals" integer;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD COLUMN "quoted_out" bigint;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD COLUMN "output_amount" bigint;