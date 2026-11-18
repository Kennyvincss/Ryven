import { EngineError } from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { getLiveToken } from "@/lib/server/live-market";
import { mintParam, shortCache, upstream } from "@/lib/server/live-routes";

/** Public: live header data for any token. */
export const GET = handler(async (req: Request, { params }: { params: Promise<{ mint: string }> }) => {
  enforceRateLimit(req, "live", 240, 60_000);
  const mint = mintParam((await params).mint);
  const token = await upstream("Token data", () => getLiveToken(mint));
  if (!token) throw new EngineError("No market data for this token yet.", 404);
  return json({ token }, shortCache);
});
