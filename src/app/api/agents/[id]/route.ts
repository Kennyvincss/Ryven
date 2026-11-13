import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/server/auth";
import { PolicyInput, ProfileInput, requireCreator } from "@/lib/server/agents";
import { db, schema } from "@/lib/server/db";
import { logActivity } from "@/lib/server/engine/activity";
import { EngineError } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";
import { agentPrivateView, agentStats, agentView, paymentPublicView, tokenView } from "@/lib/server/queries";

type P = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) throw new EngineError("Agent not found", 404);
  const session = await getSession();
  const isCreator = session?.wallet === agent.creatorWallet;
  const [treasury, token, stats, contributors, payments] = await Promise.all([
    db.query.treasuries.findFirst({ where: eq(schema.treasuries.agentId, id) }),
    db.query.tokens.findFirst({ where: eq(schema.tokens.id, agent.tokenId) }),
    agentStats([id]),
    db.select().from(schema.contributors).where(eq(schema.contributors.agentId, id)).orderBy(desc(schema.contributors.activityScore)),
    db
      .select()
      .from(schema.payments)
      .where(isCreator ? eq(schema.payments.agentId, id) : and(eq(schema.payments.agentId, id), eq(schema.payments.status, "confirmed")))
      .orderBy(desc(schema.payments.createdAt))
      .limit(100),
  ]);
  return json({
    agent: agentView(agent, treasury, stats.get(id)),
    private: isCreator ? agentPrivateView(agent) : null,
    isCreator,
    token: token ? tokenView(token) : null,
    contributors: contributors.map((c) => ({
      id: c.id,
      wallet: c.wallet,
      handle: c.handle,
      role: c.role,
      status: c.status,
      activityScore: c.activityScore,
      note: isCreator ? c.note : undefined,
      createdAt: c.createdAt.toISOString(),
    })),
    payments: payments.map(paymentPublicView),
  });
});

export const PATCH = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { agent } = await requireCreator(id);
  const body = await req.json();
  const profile = ProfileInput.partial().parse(body);
  const policy = body.policy ? PolicyInput.parse(body.policy) : null;
  const [updated] = await db
    .update(schema.agents)
    .set({ ...profile, ...(policy ?? {}), updatedAt: new Date() })
    .where(eq(schema.agents.id, agent.id))
    .returning();
  if (policy) {
    await logActivity({
      agentId: id,
      type: "policy_updated",
      status: "info",
      message: `Creator updated spending policy (mode ${policy.mode}, max/tx ${body.policy.maxPerTx}, daily ${body.policy.dailyLimit} USDC)`,
    });
  }
  const treasury = await db.query.treasuries.findFirst({ where: eq(schema.treasuries.agentId, id) });
  return json({ agent: agentView(updated, treasury) });
});
