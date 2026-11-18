import { timingSafeEqual } from "node:crypto";
import { runDueBriefs } from "@/lib/server/ai/brief";
import { serverEnv } from "@/lib/server/env";
import { EngineError } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";

/**
 * Generates due wallet briefs. For hosted deployments where the in-process scheduler doesn't
 * run: call hourly with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header).
 */
export const GET = handler(async (req: Request) => {
  const secret = serverEnv.cronSecret;
  if (!secret) throw new EngineError("CRON_SECRET is not set on this server", 404);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new EngineError("Unauthorized", 401);
  const results = await runDueBriefs(new Date(), 20);
  return json({ ok: true, generated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});
