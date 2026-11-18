ALTER TYPE "public"."asset" ADD VALUE 'sol';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sol_max_per_tx" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sol_auto_approve_limit" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "sol_daily_limit" bigint;