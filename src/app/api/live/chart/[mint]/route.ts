import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { CHART_INTERVALS, getCandles, type ChartInterval } from "@/lib/server/live-market";
import { mintParam, shortCache, upstream } from "@/lib/server/live-routes";

/** Public: OHLCV candles. ?interval=1s|15s|1m|5m|15m|1h|4h|1d&kind=price|mcap */
export const GET = handler(async (req: Request, { params }: { params: Promise<{ mint: string }> }) => {
  enforceRateLimit(req, "live", 240, 60_000);
  const mint = mintParam((await params).mint);
  const q = new URL(req.url).searchParams;
  const interval = (q.get("interval") ?? "1m") in CHART_INTERVALS ? (q.get("interval") as ChartInterval) : "1m";
  const kind = q.get("kind") === "price" ? "price" : "mcap";
  const candles = await upstream("Chart data", () => getCandles(mint, interval, kind, Number(q.get("candles")) || 300));
  return json({ interval, kind, candles }, shortCache);
});
