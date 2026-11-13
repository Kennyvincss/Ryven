import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { logActivity } from "@/lib/server/engine/activity";
import { EngineError } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";

const Body = z.object({ action: z.enum(["pause", "resume"]), reason: z.string().max(300).optional() });

/** Creator pause/resume. Admins may pause (emergency) but not resume someone else's agent. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSession();
  const { action, reason } = Body.parse(await req.json());
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) throw new EngineError("Agent not found", 404);
  const isCreator = agent.creatorWallet === session.wallet;
  if (!isCreator && !(session.isAdmin && action === "pause")) throw new EngineError("Not allowed", 403);
  await db
    .update(schema.agents)
    .set({
      status: action === "pause" ? "paused" : "active",
      pausedReason: action === "pause" ? (reason ?? (isCreator ? "Paused by creator" : "Paused by administrator")) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.agents.id, id));
  await logActivity({
    agentId: id,
    type: action === "pause" ? "agent_paused" : "agent_resumed",
    status: "info",
    message: action === "pause" ? `Agent paused by ${isCreator ? "creator" : "administrator"}` : "Agent resumed by creator",
  });
  return json({ ok: true });
});
