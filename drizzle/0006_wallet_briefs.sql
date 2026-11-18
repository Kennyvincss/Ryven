CREATE TABLE "wallet_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text NOT NULL,
	"content" text NOT NULL,
	"total_usd" double precision,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "brief_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "brief_hour_utc" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "brief_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallet_briefs" ADD CONSTRAINT "wallet_briefs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefs_agent_created_idx" ON "wallet_briefs" USING btree ("agent_id","created_at");