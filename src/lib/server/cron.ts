import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";
import { EngineError } from "./engine/payments";
import { bearerToken } from "./bearer";

/**
 * Cron endpoints require `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header).
 * Stray spaces or line breaks from copy-pasting (in the header or in the env var) are ignored.
 */
export function requireCron(req: Request) {
  const secret = serverEnv.cronSecret?.trim();
  if (!secret) throw new EngineError("CRON_SECRET is not set on this server", 404);
  const given = Buffer.from(bearerToken(req.headers.get("authorization")));
  const expected = Buffer.from(secret);
  if (!given.length) throw new EngineError('Unauthorized: send the header "Authorization: Bearer <your CRON_SECRET>"', 401);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new EngineError("Unauthorized: the secret after \"Bearer\" doesn't match CRON_SECRET", 401);
}
