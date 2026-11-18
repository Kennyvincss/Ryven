import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const enabled = process.env.AUTO_MIGRATE ? process.env.AUTO_MIGRATE === "true" : process.env.NODE_ENV !== "production";

if (enabled && process.env.DATABASE_URL) {
  const { db } = await import("./lib/server/db");
  try {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("✓ Database schema is up to date");
  } catch (e) {
    console.error(`✗ Could not update the database automatically: ${(e as Error).message}\n  Run "npm run db:migrate" to see details.`);
  }
}

// Daily wallet briefs: check every 10 minutes for briefs that are due (in-process scheduler for
// `npm run dev` / `npm start`). Hosted setups can call /api/cron/briefs instead (CRON_SECRET).
// BRIEF_SCHEDULER=false turns it off.
const g = globalThis as { __ryvenBriefTimer?: ReturnType<typeof setInterval> };
if (process.env.DATABASE_URL && !process.env.VERCEL && process.env.BRIEF_SCHEDULER !== "false" && !g.__ryvenBriefTimer) {
  const tick = async () => {
    try {
      const { runDueBriefs } = await import("./lib/server/ai/brief");
      const done = await runDueBriefs();
      if (done.length) console.log(`✓ Wallet briefs: ${done.filter((d) => d.ok).length} generated, ${done.filter((d) => !d.ok).length} failed`);
    } catch (e) {
      console.error(`✗ Wallet brief scheduler: ${(e as Error).message}`);
    }
  };
  g.__ryvenBriefTimer = setInterval(tick, 10 * 60_000);
  g.__ryvenBriefTimer.unref?.();
  setTimeout(tick, 30_000).unref?.();
}

// Price alerts: checked every minute (in-process). Hosted setups can call /api/cron/alerts.
// ALERT_SCHEDULER=false turns it off.
const ga = globalThis as { __ryvenAlertTimer?: ReturnType<typeof setInterval> };
if (process.env.DATABASE_URL && !process.env.VERCEL && process.env.ALERT_SCHEDULER !== "false" && !ga.__ryvenAlertTimer) {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap
    running = true;
    try {
      const { checkAlerts } = await import("./lib/server/alerts");
      const r = await checkAlerts();
      if (r.triggered) console.log(`🔔 Price alerts: ${r.triggered} triggered (${r.checked} checked)`);
    } catch (e) {
      console.error(`✗ Price alert checker: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  ga.__ryvenAlertTimer = setInterval(tick, 60_000);
  ga.__ryvenAlertTimer.unref?.();
  setTimeout(tick, 20_000).unref?.();
}
