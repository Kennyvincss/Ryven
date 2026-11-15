import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { fromBaseUnits } from "../shared/amounts";
import { USDC_DECIMALS, explorerTx } from "../shared/config";

type Agent = typeof schema.agents.$inferSelect;
type Token = typeof schema.tokens.$inferSelect;
type Treasury = typeof schema.treasuries.$inferSelect;
type Payment = typeof schema.payments.$inferSelect;

const usd = (v: bigint) => fromBaseUnits(v, USDC_DECIMALS);

export function tokenView(t: Token) {
  return {
    id: t.id,
    mint: t.mint,
    name: t.name,
    symbol: t.symbol,
    description: t.description,
    imageUri: t.imageUri,
    metadataUri: t.metadataUri,
    creatorWallet: t.creatorWallet,
    decimals: t.decimals,
    totalSupply: fromBaseUnits(t.totalSupply, t.decimals),
    launchMode: t.launchMode,
    network: t.network,
    launchStatus: t.launchStatus,
    launchSignature: t.launchSignature,
    curveAddress: t.curveAddress,
    website: t.website,
    twitter: t.twitter,
    telegram: t.telegram,
    createdAt: t.createdAt.toISOString(),
  };
}
export type TokenView = ReturnType<typeof tokenView>;

/** Public agent view: policy is public (transparency), keys are never included. */
export function agentView(a: Agent, treasury: Treasury | null | undefined, stats?: AgentStats) {
  return {
    id: a.id,
    tokenId: a.tokenId,
    name: a.name,
    description: a.description,
    personality: a.personality,
    objectives: a.objectives,
    avatarSeed: a.avatarSeed,
    status: a.status,
    pausedReason: a.pausedReason,
    mode: a.mode,
    creatorWallet: a.creatorWallet,
    signerPubkey: a.signerPubkey,
    policy: {
      maxPerTx: usd(a.maxPerTx),
      autoApproveLimit: usd(a.autoApproveLimit),
      dailyLimit: usd(a.dailyLimit),
      categories: a.categories,
      recipientPolicy: a.recipientPolicy,
    },
    tokenPolicy:
      a.tokenDailyLimit !== null
        ? {
            maxPerTx: fromBaseUnits(a.tokenMaxPerTx ?? 0n, 6),
            autoApproveLimit: fromBaseUnits(a.tokenAutoApproveLimit ?? 0n, 6),
            dailyLimit: fromBaseUnits(a.tokenDailyLimit, 6),
          }
        : null,
    trading: {
      mode: a.tradingMode,
      maxSolPerTrade: fromBaseUnits(a.tradeMaxSol, 9),
      dailySol: fromBaseUnits(a.tradeDailySol, 9),
      mints: a.tradeMints,
    },
    treasury: treasury
      ? {
          address: treasury.address,
          mint: treasury.mint,
          ownerWallet: treasury.ownerWallet,
          seed: treasury.seed,
          cachedBalance: usd(treasury.lastBalance),
          cachedAllowance: usd(treasury.lastAllowance),
          lastSyncedAt: treasury.lastSyncedAt?.toISOString() ?? null,
          totalDeposits: usd(treasury.totalDeposits),
          totalSpent: usd(treasury.totalSpent),
        }
      : null,
    stats: stats ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}
export type AgentView = ReturnType<typeof agentView>;

/** Creator-only fields. */
export function agentPrivateView(a: Agent) {
  return { instructions: a.instructions };
}

export function paymentPublicView(p: Payment) {
  return {
    id: p.id,
    recipient: p.recipient,
    amount: fromBaseUnits(p.amount, p.decimals),
    asset: p.asset,
    unit: p.asset === "usdc" ? "USDC" : `$${p.symbol}`,
    mint: p.mint,
    category: p.category,
    campaign: p.campaign,
    reason: p.reason,
    status: p.status,
    source: p.source,
    signature: p.signature,
    explorerUrl: p.signature && p.status === "confirmed" ? explorerTx(p.signature) : null,
    policy: p.policy,
    error: p.error,
    createdAt: p.createdAt.toISOString(),
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
  };
}
export type PaymentPublicView = ReturnType<typeof paymentPublicView>;

export type AgentStats = {
  confirmedPayments: number;
  confirmedVolume: string;
  tasksCompleted: number;
  pendingApprovals: number;
  lastActivityAt: string | null;
};

export async function agentStats(agentIds: string[]): Promise<Map<string, AgentStats>> {
  const out = new Map<string, AgentStats>();
  if (!agentIds.length) return out;
  const pay = await db
    .select({
      agentId: schema.payments.agentId,
      confirmed: sql<number>`count(*) filter (where ${schema.payments.status} = 'confirmed')::int`,
      volume: sql<string>`coalesce(sum(${schema.payments.amount}) filter (where ${schema.payments.status} = 'confirmed' and ${schema.payments.asset} = 'usdc'), 0)::text`,
      pending: sql<number>`count(*) filter (where ${schema.payments.status} = 'awaiting_approval')::int`,
      instructions: sql<number>`count(distinct ${schema.payments.instructionId}) filter (where ${schema.payments.status} = 'confirmed')::int`,
    })
    .from(schema.payments)
    .where(inArray(schema.payments.agentId, agentIds))
    .groupBy(schema.payments.agentId);
  const act = await db
    .select({ agentId: schema.agentActivities.agentId, last: sql<Date>`max(${schema.agentActivities.createdAt})` })
    .from(schema.agentActivities)
    .where(inArray(schema.agentActivities.agentId, agentIds))
    .groupBy(schema.agentActivities.agentId);
  for (const id of agentIds) {
    const p = pay.find((r) => r.agentId === id);
    const a = act.find((r) => r.agentId === id);
    out.set(id, {
      confirmedPayments: p?.confirmed ?? 0,
      confirmedVolume: usd(BigInt(p?.volume ?? "0")),
      tasksCompleted: p?.instructions ?? 0,
      pendingApprovals: p?.pending ?? 0,
      lastActivityAt: a?.last ? new Date(a.last).toISOString() : null,
    });
  }
  return out;
}

export async function listAgents(opts: { sort?: string; creator?: string; limit?: number }) {
  const conds = [];
  if (opts.creator) conds.push(eq(schema.agents.creatorWallet, opts.creator));
  const rows = await db
    .select({ agent: schema.agents, treasury: schema.treasuries, token: schema.tokens })
    .from(schema.agents)
    .leftJoin(schema.treasuries, and(eq(schema.treasuries.agentId, schema.agents.id), eq(schema.treasuries.asset, "usdc")))
    .innerJoin(schema.tokens, eq(schema.tokens.id, schema.agents.tokenId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.agents.createdAt))
    .limit(Math.min(opts.limit ?? 60, 200));
  const stats = await agentStats(rows.map((r) => r.agent.id));
  const list = rows.map((r) => ({
    ...agentView(r.agent, r.treasury, stats.get(r.agent.id)),
    token: { mint: r.token.mint, name: r.token.name, symbol: r.token.symbol, imageUri: r.token.imageUri },
  }));
  const num = (s: string) => Number(s);
  switch (opts.sort) {
    case "active":
      list.sort((a, b) => (b.stats?.confirmedPayments ?? 0) - (a.stats?.confirmedPayments ?? 0));
      break;
    case "volume":
      list.sort((a, b) => num(b.stats?.confirmedVolume ?? "0") - num(a.stats?.confirmedVolume ?? "0"));
      break;
    case "funded":
      list.sort((a, b) => num(b.treasury?.cachedBalance ?? "0") - num(a.treasury?.cachedBalance ?? "0"));
      break;
    case "trending":
      list.sort((a, b) => (b.stats?.lastActivityAt ?? "").localeCompare(a.stats?.lastActivityAt ?? ""));
      break;
  }
  return list;
}

export async function listTokens(opts: { sort?: string; creator?: string; limit?: number }) {
  const conds = [eq(schema.tokens.launchStatus, "live")];
  if (opts.creator) conds.push(eq(schema.tokens.creatorWallet, opts.creator));
  if (opts.sort === "graduated") conds[0] = eq(schema.tokens.launchStatus, "graduated");
  const rows = await db
    .select({ token: schema.tokens, agent: schema.agents })
    .from(schema.tokens)
    .leftJoin(schema.agents, eq(schema.agents.tokenId, schema.tokens.id))
    .where(and(...conds))
    .orderBy(desc(schema.tokens.createdAt))
    .limit(Math.min(opts.limit ?? 60, 200));
  const tokenIds = rows.map((r) => r.token.id);
  const volumes = tokenIds.length
    ? await db
        .select({
          tokenId: schema.tokenTrades.tokenId,
          volume: sql<string>`coalesce(sum(${schema.tokenTrades.solAmount}), 0)::text`,
          trades: sql<number>`count(*)::int`,
          lastPrice: sql<string | null>`(array_agg(${schema.tokenTrades.priceLamportsPerToken} order by ${schema.tokenTrades.blockTime} desc))[1]`,
        })
        .from(schema.tokenTrades)
        .where(inArray(schema.tokenTrades.tokenId, tokenIds))
        .groupBy(schema.tokenTrades.tokenId)
    : [];
  const agentIds = rows.map((r) => r.agent?.id).filter(Boolean) as string[];
  const stats = await agentStats(agentIds);
  const list = rows.map((r) => {
    const v = volumes.find((x) => x.tokenId === r.token.id);
    return {
      ...tokenView(r.token),
      volumeLamports: v?.volume ?? "0",
      trades: v?.trades ?? 0,
      lastPriceLamports: v?.lastPrice ?? null,
      agent: r.agent
        ? { id: r.agent.id, name: r.agent.name, status: r.agent.status, paymentsVolume: stats.get(r.agent.id)?.confirmedVolume ?? "0" }
        : null,
    };
  });
  switch (opts.sort) {
    case "agents":
      return list.filter((t) => t.agent);
    case "volume":
      return list.sort((a, b) => Number(BigInt(b.volumeLamports) - BigInt(a.volumeLamports)));
    case "agent_activity":
      return list.filter((t) => t.agent).sort((a, b) => Number(b.agent!.paymentsVolume) - Number(a.agent!.paymentsVolume));
    case "trending":
      return list.sort((a, b) => b.trades - a.trades);
  }
  return list;
}

export async function platformStats() {
  const [tokens] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tokens).where(eq(schema.tokens.launchStatus, "live"));
  const [agents] = await db
    .select({ n: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${schema.agents.status} = 'active')::int` })
    .from(schema.agents);
  const [payments] = await db
    .select({
      n: sql<number>`count(*) filter (where ${schema.payments.status} = 'confirmed')::int`,
      volume: sql<string>`coalesce(sum(${schema.payments.amount}) filter (where ${schema.payments.status} = 'confirmed' and ${schema.payments.asset} = 'usdc'), 0)::text`,
      failed: sql<number>`count(*) filter (where ${schema.payments.status} = 'failed')::int`,
    })
    .from(schema.payments);
  const [treasury] = await db
    .select({
      managed: sql<string>`coalesce(sum(${schema.treasuries.lastBalance}), 0)::text`,
      deposits: sql<string>`coalesce(sum(${schema.treasuries.totalDeposits}), 0)::text`,
    })
    .from(schema.treasuries)
    .where(eq(schema.treasuries.asset, "usdc"));
  const [users] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  return {
    tokensLaunched: tokens.n,
    agentsDeployed: agents.n,
    activeAgents: agents.active,
    confirmedPayments: payments.n,
    paymentVolume: usd(BigInt(payments.volume)),
    failedPayments: payments.failed,
    usdcManaged: usd(BigInt(treasury.managed)),
    totalDeposits: usd(BigInt(treasury.deposits)),
    users: users.n,
  };
}
