import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { isPlatformPaused } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";
import { listAgents, paymentPublicView, platformStats } from "@/lib/server/queries";

export const GET = handler(async () => {
  await requireAdmin();
  const [stats, paused, agents, failed] = await Promise.all([
    platformStats(),
    isPlatformPaused(),
    listAgents({ sort: "recent", limit: 100 }),
    db.select().from(schema.payments).where(eq(schema.payments.status, "failed")).orderBy(desc(schema.payments.createdAt)).limit(25),
  ]);
  return json({ stats, paymentsPaused: paused, agents, failedPayments: failed.map(paymentPublicView) });
});

const Body = z.object({ paymentsPaused: z.boolean() });

/** Platform-wide emergency kill switch for agent payment execution. */
export const POST = handler(async (req: Request) => {
  const { wallet } = await requireAdmin();
  const { paymentsPaused } = Body.parse(await req.json());
  await db
    .insert(schema.platformSettings)
    .values({ key: "payments_paused", value: paymentsPaused, updatedBy: wallet })
    .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value: paymentsPaused, updatedBy: wallet, updatedAt: sql`now()` } });
  return json({ paymentsPaused });
});
