ALTER TABLE "agents" ADD COLUMN "network" "network" DEFAULT 'devnet' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "network" "network" DEFAULT 'devnet' NOT NULL;