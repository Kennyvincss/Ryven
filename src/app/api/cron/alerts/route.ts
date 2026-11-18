import { checkAlerts } from "@/lib/server/alerts";
import { requireCron } from "@/lib/server/cron";
import { handler, json } from "@/lib/server/http";

/** Checks every active price alert. Call every minute (or as often as your cron allows) with `Authorization: Bearer <CRON_SECRET>`. */
export const GET = handler(async (req: Request) => {
  requireCron(req);
  return json({ ok: true, ...(await checkAlerts()) });
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
