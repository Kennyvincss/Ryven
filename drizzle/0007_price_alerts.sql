CREATE TYPE "public"."alert_status" AS ENUM('active', 'triggered', 'cancelled');--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"mint" text NOT NULL,
	"symbol" text NOT NULL,
	"metric" text NOT NULL,
	"direction" text NOT NULL,
	"target" double precision NOT NULL,
	"base_value" double precision,
	"condition" text NOT NULL,
	"note" text,
	"status" "alert_status" DEFAULT 'active' NOT NULL,
	"triggered_value" double precision,
	"triggered_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_value" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_agent_idx" ON "price_alerts" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "price_alerts" USING btree ("status");