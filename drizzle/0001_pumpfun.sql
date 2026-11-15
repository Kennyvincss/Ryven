CREATE TYPE "public"."network" AS ENUM('devnet', 'mainnet');--> statement-breakpoint
ALTER TYPE "public"."launch_mode" ADD VALUE 'pumpfun';--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "network" "network" DEFAULT 'devnet' NOT NULL;