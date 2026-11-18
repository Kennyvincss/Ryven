import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { SwapRequest, userQuote } from "@/lib/server/user-swap";

/** Public: a live Jupiter quote. ?input=&output=&amount=<raw>&slippageBps= */
export const GET = handler(async (req: Request) => {
  enforceRateLimit(req, "swap-quote", 90, 60_000);
  const q = new URL(req.url).searchParams;
  const r = SwapRequest.parse({ input: q.get("input"), output: q.get("output"), amount: q.get("amount"), slippageBps: Number(q.get("slippageBps") ?? 500) });
  return json({ quote: await userQuote(r) });
});
