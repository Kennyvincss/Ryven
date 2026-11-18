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
