import { z } from "zod";
import { verifySignIn } from "@/lib/server/auth";
import { enforceRateLimit, handler, json } from "@/lib/server/http";

const Body = z.object({ wallet: z.string(), nonce: z.string(), signature: z.string() });

export const POST = handler(async (req: Request) => {
  enforceRateLimit(req, "auth", 20);
  const { wallet, nonce, signature } = Body.parse(await req.json());
  return json(await verifySignIn(wallet, nonce, signature));
});
