import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { getPulse } from "@/lib/server/live-market";
import { shortCache, upstream } from "@/lib/server/live-routes";

/** Public: live pump.fun columns (new pairs, about to graduate, graduated). */
export const GET = handler(async (req: Request) => {
  enforceRateLimit(req, "live", 240, 60_000);
  return json(await upstream("Live feed", getPulse), shortCache);
});
