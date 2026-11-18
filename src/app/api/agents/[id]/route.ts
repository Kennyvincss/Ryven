import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/server/auth";
import { BriefInput, PolicyInput, ProfileInput, SolPolicyInput, TokenPolicyInput, TradingInput, requireCreator } from "@/lib/server/agents";
import { db, schema } from "@/lib/server/db";
import { logActivity } from "@/lib/server/engine/activity";
import { EngineError } from "@/lib/server/engine/payments";
import { handler, json } from "@/lib/server/http";
import { agentPrivateView, agentStats, agentView, paymentCreatorView, paymentPublicView, tokenView } from "@/lib/server/queries";

type P = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) throw new EngineError("Agent not found", 404);
  const session = await getSession();
  const isCreator = session?.wallet === agent.creatorWallet;
  const [treasury, token, stats, contributors, payments] = await Promise.all([
    db.query.treasuries.findFirst({ where: and(eq(schema.treasuries.agentId, id), eq(schema.treasuries.asset, "usdc")) }),
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
    contributors: contributors.filter((c) => isCreator || c.status === "approved").map((c) => ({
      id: c.id,
      wallet: c.wallet,
      handle: c.handle,
      role: c.role,
      status: c.status,
      activityScore: isCreator ? c.activityScore : undefined,
      note: isCreator ? c.note : undefined,
      createdAt: c.createdAt.toISOString(),
    })),
    payments: payments.map((p) => (isCreator ? paymentCreatorView(p) : paymentPublicView(p))),
  });
});

export const PATCH = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { agent } = await requireCreator(id);
  const body = await req.json();
  const profile = ProfileInput.partial().parse(body);
  const policy = body.policy ? PolicyInput.parse(body.policy) : null;
  const tokenPolicy = "tokenPolicy" in body ? TokenPolicyInput.parse(body.tokenPolicy) : undefined;
  const trading = body.trading ? TradingInput.parse(body.trading) : null;
  const solPolicy = "solPolicy" in body ? SolPolicyInput.parse(body.solPolicy) : undefined;
  const brief = body.brief ? BriefInput.parse(body.brief) : null;
  const [updated] = await db
    .update(schema.agents)
    .set({
      ...profile,
      ...(policy ?? {}),
      ...(tokenPolicy !== undefined
        ? {
            tokenMaxPerTx: tokenPolicy?.maxPerTx ?? null,
            tokenAutoApproveLimit: tokenPolicy?.autoApproveLimit ?? null,
            tokenDailyLimit: tokenPolicy?.dailyLimit ?? null,
          }
        : {}),
      ...(solPolicy !== undefined
        ? { solMaxPerTx: solPolicy?.maxPerTx ?? null, solAutoApproveLimit: solPolicy?.autoApproveLimit ?? null, solDailyLimit: solPolicy?.dailyLimit ?? null }
        : {}),
      ...(trading
        ? { tradingMode: trading.mode, tradeMaxSol: trading.maxSolPerTrade, tradeDailySol: trading.dailySol, tradeMints: trading.mints }
        : {}),
      ...(brief ? { briefEnabled: brief.enabled, briefHourUtc: brief.hourUtc } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.agents.id, agent.id))
    .returning();
  if (tokenPolicy !== undefined) {
    await logActivity({
      agentId: id,
      type: "policy_updated",
      status: "info",
      message: tokenPolicy
        ? `Creator enabled token rewards (max/payment ${body.tokenPolicy.maxPerTx}, daily ${body.tokenPolicy.dailyLimit})`
        : "Creator disabled token rewards",
    });
  }
  if (solPolicy !== undefined) {
    await logActivity({
      agentId: id,
      type: "policy_updated",
      status: "info",
      message: solPolicy ? `Creator enabled SOL payments (max/payment ${body.solPolicy.maxPerTx} SOL, daily ${body.solPolicy.dailyLimit} SOL)` : "Creator disabled SOL payments",
    });
  }
  if (trading) {
    await logActivity({
      agentId: id,
      type: "policy_updated",
      status: "info",
      message:
        trading.mode === "off"
          ? "Creator turned trading off"
          : `Creator set trading to ${trading.mode} mode (max ${body.trading.maxSolPerTrade} SOL/trade, ${body.trading.dailySol} SOL/day, ${trading.mints.length} coin(s))`,
    });
  }
  if (brief) {
    await logActivity({
      agentId: id,
      type: "policy_updated",
      status: "info",
      isPublic: false,
      message: brief.enabled ? `Creator turned on the daily wallet brief (${String(brief.hourUtc).padStart(2, "0")}:00 UTC)` : "Creator turned off the daily wallet brief",
    });
  }
  if (policy) {
    await logActivity({
      agentId: id,
      type: "policy_updated",
      status: "info",
      message: `Creator updated spending policy (mode ${policy.mode}, max/tx ${body.policy.maxPerTx}, daily ${body.policy.dailyLimit} USDC)`,
    });
  }
  const treasury = await db.query.treasuries.findFirst({ where: and(eq(schema.treasuries.agentId, id), eq(schema.treasuries.asset, "usdc")) });
  return json({ agent: agentView(updated, treasury) });
});
