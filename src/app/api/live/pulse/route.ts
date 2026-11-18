import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { getPulse } from "@/lib/server/live-market";
import { shortCache, upstream } from "@/lib/server/live-routes";
import type { PulseFilters } from "@/lib/shared/live-filters";

/** Public: live pump.fun columns (new pairs, about to graduate, graduated), unfiltered. */
export const GET = handler(async (req: Request) => {
  enforceRateLimit(req, "live", 240, 60_000);
  return json(await upstream("Live feed", () => getPulse()), shortCache);
});

/** Public: the same columns with per-column filters ({ newPairs?, aboutToGraduate?, graduated? }). */
export const POST = handler(async (req: Request) => {
  enforceRateLimit(req, "live", 240, 60_000);
  const raw = await req.text();
  let filters: PulseFilters = {};
  if (raw.length > 0 && raw.length < 8_000) {
    try {
      filters = JSON.parse(raw) as PulseFilters; // sanitised field by field in getPulse
    } catch {
      filters = {};
    }
  }
  return json(await upstream("Live feed", () => getPulse(filters)));
});
