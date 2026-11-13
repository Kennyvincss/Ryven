import { z } from "zod";
import { createNonce } from "@/lib/server/auth";
import { enforceRateLimit, handler, json } from "@/lib/server/http";

const Body = z.object({ wallet: z.string() });

export const POST = handler(async (req: Request) => {
  enforceRateLimit(req, "auth", 20);
  const { wallet } = Body.parse(await req.json());
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  return json(await createNonce(wallet, origin));
});
