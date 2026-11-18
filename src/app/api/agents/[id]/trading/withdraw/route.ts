import { requireCreator } from "@/lib/server/agents";
import { EngineError } from "@/lib/server/engine/payments";
import { withdrawTradingWallet } from "@/lib/server/engine/trading";
import { PumpFunError } from "@/lib/server/pumpfun";
import { enforceRateLimit, handler, json } from "@/lib/server/http";

/** Creator-only kill switch: move every token and all SOL from the agent's trading wallet back to the creator. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { session } = await requireCreator(id);
  enforceRateLimit(req, "trade-withdraw", 5, 60_000, session.wallet);
  try {
    return json(await withdrawTradingWallet(id, session.wallet));
  } catch (e) {
    if (e instanceof PumpFunError) throw new EngineError(e.message, 400);
    throw e;
  }
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
