import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireCreator } from "@/lib/server/agents";
import { db, schema } from "@/lib/server/db";
import { logActivity } from "@/lib/server/engine/activity";
import { EngineError } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";

type P = { params: Promise<{ id: string; cid: string }> };
const Patch = z.object({
  status: z.enum(["approved", "suspended"]).optional(),
  activityScore: z.number().int().min(0).max(1_000_000).optional(),
  role: z.string().trim().max(40).optional(),
  note: z.string().trim().max(300).optional(),
});

export const PATCH = handler(async (req: Request, { params }: P) => {
  const { id, cid } = await params;
  await requireCreator(id);
  const b = Patch.parse(await req.json());
  const [row] = await db
    .update(schema.contributors)
    .set(b)
    .where(and(eq(schema.contributors.id, cid), eq(schema.contributors.agentId, id)))
    .returning();
  if (!row) throw new EngineError("Contributor not found", 404);
  if (b.status) {
    await logActivity({ agentId: id, type: "contributor_updated", status: "info", message: `Contributor @${row.handle} ${b.status === "approved" ? "re-approved" : "suspended"}` });
  }
  return json({ contributor: row });
});

export const DELETE = handler(async (_req: Request, { params }: P) => {
  const { id, cid } = await params;
  await requireCreator(id);
  const [row] = await db
    .delete(schema.contributors)
    .where(and(eq(schema.contributors.id, cid), eq(schema.contributors.agentId, id)))
    .returning();
  if (!row) throw new EngineError("Contributor not found", 404);
  await logActivity({ agentId: id, type: "contributor_removed", status: "info", message: `Contributor @${row.handle} removed` });
  return json({ ok: true });
});
