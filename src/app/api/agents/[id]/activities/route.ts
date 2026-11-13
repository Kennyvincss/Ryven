import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { EngineError } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) throw new EngineError("Agent not found", 404);
  const isCreator = (await getSession())?.wallet === agent.creatorWallet;
  const rows = await db
    .select()
    .from(schema.agentActivities)
    .where(isCreator ? eq(schema.agentActivities.agentId, id) : and(eq(schema.agentActivities.agentId, id), eq(schema.agentActivities.isPublic, true)))
    .orderBy(desc(schema.agentActivities.createdAt))
    .limit(100);
  return json({ activities: rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })) });
});
