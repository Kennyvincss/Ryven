-- Existing agents keep USDC as their main treasury; new agents default to SOL.
ALTER TABLE "agents" ADD COLUMN "primary_asset" "asset" DEFAULT 'usdc' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "primary_asset" SET DEFAULT 'sol';
