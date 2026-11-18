import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { getTrades } from "@/lib/server/live-market";
import { mintParam, shortCache, upstream } from "@/lib/server/live-routes";

/** Public: latest trades of a token. */
export const GET = handler(async (req: Request, { params }: { params: Promise<{ mint: string }> }) => {
  enforceRateLimit(req, "live", 240, 60_000);
  const mint = mintParam((await params).mint);
  return json({ trades: await upstream("Trades", () => getTrades(mint, 40)) }, shortCache);
});
