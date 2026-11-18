import { z } from "zod";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { SwapRequest, buildUserSwap } from "@/lib/server/user-swap";

const Body = SwapRequest.and(z.object({ wallet: SwapRequest.shape.input }));

/** Public: builds, checks and simulates a swap for the caller's wallet, which then signs it. */
export const POST = handler(async (req: Request) => {
  enforceRateLimit(req, "swap-build", 30, 60_000);
  const b = Body.parse(await req.json());
  return json(await buildUserSwap(b));
});

export const maxDuration = 60;
