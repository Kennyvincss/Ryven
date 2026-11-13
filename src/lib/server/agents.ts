import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";
import { AuthError, requireSession } from "./auth";
import { EngineError } from "./engine/payments";
import { toBaseUnits } from "../shared/amounts";
import { PAYMENT_CATEGORY_IDS, USDC_DECIMALS } from "../shared/config";

export async function requireCreator(agentId: string) {
  const session = await requireSession();
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
  if (!agent) throw new EngineError("Agent not found", 404);
  if (agent.creatorWallet !== session.wallet) throw new AuthError("Only this agent's creator can do that", 403);
  return { session, agent };
}

const usdcAmount = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Use a decimal amount like 5 or 2.5")
  .transform((v) => toBaseUnits(v, USDC_DECIMALS));

const MAX_DAILY = toBaseUnits("100000", USDC_DECIMALS);

export const PolicyInput = z
  .object({
    mode: z.enum(["autonomous", "approval"]),
    maxPerTx: usdcAmount,
    autoApproveLimit: usdcAmount,
    dailyLimit: usdcAmount,
    categories: z.array(z.enum(PAYMENT_CATEGORY_IDS)).min(1),
    recipientPolicy: z.enum(["allowlist_only", "allowlist_or_approval"]),
  })
  .refine((p) => p.maxPerTx > 0n && p.dailyLimit > 0n, "Limits must be greater than zero")
  .refine((p) => p.autoApproveLimit <= p.maxPerTx, "Autonomous limit cannot exceed the max per transaction")
  .refine((p) => p.maxPerTx <= p.dailyLimit, "Max per transaction cannot exceed the daily limit")
  .refine((p) => p.dailyLimit <= MAX_DAILY, "Daily limit too high for this deployment");

export const ProfileInput = z.object({
  name: z.string().trim().min(2).max(48),
  description: z.string().trim().max(500).default(""),
  personality: z.string().trim().max(500).default(""),
  objectives: z.string().trim().max(1000).default(""),
  instructions: z.string().trim().max(2000).default(""),
});
