import { runDueBriefs } from "@/lib/server/ai/brief";
import { requireCron } from "@/lib/server/cron";
import { handler, json } from "@/lib/server/http";

/**
 * Generates due wallet briefs. For hosted deployments where the in-process scheduler doesn't
 * run: call hourly with `Authorization: Bearer <CRON_SECRET>`.
 */
export const GET = handler(async (req: Request) => {
  requireCron(req);
  const results = await runDueBriefs(new Date(), 20);
  return json({ ok: true, generated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
