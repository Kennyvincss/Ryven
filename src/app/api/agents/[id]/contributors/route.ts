import { z } from "zod";
import { requireCreator } from "@/lib/server/agents";
import { isValidWallet } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { logActivity } from "@/lib/server/engine/activity";
import { EngineError } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";

const Body = z.object({
  wallet: z.string().refine(isValidWallet, "Invalid Solana wallet address"),
  handle: z.string().trim().min(1).max(40),
  role: z.string().trim().max(40).default("community"),
  activityScore: z.number().int().min(0).max(1_000_000).default(0),
  note: z.string().trim().max(300).default(""),
});

/** Creator adds an approved contributor (recipient allowlist entry). */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { session, agent } = await requireCreator(id);
  const b = Body.parse(await req.json());
  if (b.wallet === agent.signerPubkey) throw new EngineError("Cannot add the agent itself");
  const [row] = await db
    .insert(schema.contributors)
    .values({ agentId: id, ...b, addedBy: session.wallet })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new EngineError("That wallet is already in the registry", 409);
  await logActivity({ agentId: id, type: "contributor_added", status: "info", message: `Approved contributor @${b.handle} added by creator` });
  return json({ contributor: row });
});
