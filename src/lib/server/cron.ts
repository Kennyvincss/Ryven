import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";
import { EngineError } from "./engine/payments";

/** Cron endpoints require `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header). */
export function requireCron(req: Request) {
  const secret = serverEnv.cronSecret;
  if (!secret) throw new EngineError("CRON_SECRET is not set on this server", 404);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new EngineError("Unauthorized", 401);
}
