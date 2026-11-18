import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
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

/** Limits for rewards paid in the agent's own token (6 decimals). null disables token rewards. */
export const TokenPolicyInput = z
  .object({
    maxPerTx: usdcAmount,
    autoApproveLimit: usdcAmount,
    dailyLimit: usdcAmount,
  })
  .refine((p) => p.maxPerTx > 0n && p.dailyLimit > 0n, "Token limits must be greater than zero")
  .refine((p) => p.autoApproveLimit <= p.maxPerTx, "Token autonomous limit cannot exceed the max per payment")
  .refine((p) => p.maxPerTx <= p.dailyLimit, "Token max per payment cannot exceed the token daily limit")
  .nullable();

const lamportsAmount = z
  .string()
  .regex(/^\d+(\.\d{1,9})?$/, "Use a SOL amount like 0.05")
  .transform((v) => toBaseUnits(v, 9));

/** Limits for SOL payments (lamports). null disables SOL payments. */
export const SolPolicyInput = z
  .object({ maxPerTx: lamportsAmount, autoApproveLimit: lamportsAmount, dailyLimit: lamportsAmount })
  .refine((p) => p.maxPerTx >= 1_000_000n && p.dailyLimit > 0n, "SOL max per payment must be at least 0.001 SOL")
  .refine((p) => p.autoApproveLimit <= p.maxPerTx, "SOL autonomous limit cannot exceed the max per payment")
  .refine((p) => p.maxPerTx <= p.dailyLimit, "SOL max per payment cannot exceed the SOL daily limit")
  .refine((p) => p.dailyLimit <= toBaseUnits("100", 9), "SOL daily limit is capped at 100 SOL")
  .nullable();

const solAmount = z
  .string()
  .regex(/^\d+(\.\d{1,9})?$/, "Use a SOL amount like 0.05")
  .transform((v) => toBaseUnits(v, 9));
const pubkey = z.string().refine((v) => {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}, "Invalid token address");

/** pump.fun trading limits (mainnet). Hard ceilings protect against fat-finger settings. */
export const TradingInput = z
  .object({
    mode: z.enum(["off", "proposal", "autonomous"]),
    maxSolPerTrade: solAmount,
    dailySol: solAmount,
    mints: z.array(pubkey).max(20),
  })
  .refine((p) => p.maxSolPerTrade <= p.dailySol, "Max per trade cannot exceed the daily SOL limit")
  .refine((p) => p.dailySol <= toBaseUnits("25", 9), "Daily SOL limit is capped at 25 SOL")
  .refine((p) => p.mode === "off" || p.maxSolPerTrade > 0n, "Set a max SOL per trade");

export const ProfileInput = z.object({
  name: z.string().trim().min(2).max(48),
  description: z.string().trim().max(500).default(""),
  personality: z.string().trim().max(500).default(""),
  objectives: z.string().trim().max(1000).default(""),
  instructions: z.string().trim().max(2000).default(""),
});
