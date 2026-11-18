-- Activity is creator-only unless its type is one of the public, on-chain facts.
UPDATE "agent_activities" SET "is_public" = false
WHERE "type" NOT IN ('deployed', 'payment_confirmed', 'treasury_deposit', 'agent_paused', 'agent_resumed');--> statement-breakpoint
-- Older self-pause entries included the agent's private reason in the public message.
UPDATE "agent_activities" SET "message" = 'Agent paused itself'
WHERE "type" = 'agent_paused' AND "message" LIKE 'Agent paused itself:%';--> statement-breakpoint
ALTER TABLE "agent_activities" ALTER COLUMN "is_public" SET DEFAULT false;
