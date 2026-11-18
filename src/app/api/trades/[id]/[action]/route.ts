import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { EngineError } from "@/lib/server/engine/payments";
import { buildCreatorTrade, cancelTrade, submitCreatorTrade, tradeView } from "@/lib/server/engine/trading";
import { enforceRateLimit, handler, json } from "@/lib/server/http";

const Submit = z.object({ signedTransaction: z.string().max(4000) });

/** Proposal-mode trades: build (unsigned tx for the creator's wallet), submit (signed), cancel. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string; action: string }> }) => {
  const { id, action } = await params;
  const { wallet } = await requireSession();
  enforceRateLimit(req, "trades", 20, 60_000, wallet);
  if (action === "build") return json({ transaction: await buildCreatorTrade(id, wallet) });
  if (action === "submit") {
    const { signedTransaction } = Submit.parse(await req.json());
    return json({ trade: tradeView(await submitCreatorTrade(id, wallet, signedTransaction)) });
  }
  if (action === "cancel") return json({ trade: tradeView(await cancelTrade(id, wallet)) });
  throw new EngineError("Unknown action", 404);
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
