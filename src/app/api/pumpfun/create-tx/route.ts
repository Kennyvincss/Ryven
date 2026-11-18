import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { EngineError } from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { PumpFunError, buildCreateTransaction } from "@/lib/server/pumpfun";
import { requirePumpFunEnabled } from "@/lib/server/pumpfun-routes";

const Body = z.object({
  mint: z.string().min(32).max(44),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10),
  uri: z.string().startsWith("https://ipfs.io/ipfs/").max(200),
  devBuySol: z.number().min(0).max(10),
});

/** Returns the PumpPortal create transaction (unsigned, validated, simulated) as base64. */
export const POST = handler(async (req: Request) => {
  requirePumpFunEnabled();
  const { wallet } = await requireSession();
  enforceRateLimit(req, "pump-create", 10, 60_000, wallet);
  const b = Body.parse(await req.json());
  try {
    const { tx } = await buildCreateTransaction({ creator: wallet, ...b });
    return json({ transaction: Buffer.from(tx.serialize()).toString("base64") });
  } catch (e) {
    if (e instanceof PumpFunError) throw new EngineError(e.message, 400);
    throw e;
  }
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
