import "server-only";
/**
 * Daily wallet brief: a portfolio analysis of the creator's wallet (and the agent's trading
 * wallet in autonomous mode), what changed since the last brief, and a few concrete ideas.
 * Ideas only: a brief never trades or pays. Generated on a schedule (briefs-scheduler.ts)
 * or on demand from the console.
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "../db";
import { serverEnv } from "../env";
import { analyzePortfolio, portfolioForModel, type Portfolio } from "../portfolio";
import { logActivity } from "../engine/activity";
import { EngineError } from "../engine/payments";
import { dueSince } from "./brief-schedule";

export type Brief = typeof schema.walletBriefs.$inferSelect;

const SYSTEM = `You write a short daily wallet brief for a Solana token creator, from live data you are given.
Format (plain text, no markdown tables, no headings with #):
Snapshot: one or two lines with total value, allocation and the biggest holdings.
Since last brief: what changed (value, holdings, notable moves) if previous data is given; otherwise skip this line.
Watch: the most important risk flags, if any.
Ideas: 2-4 concrete, specific ideas the creator could act on (e.g. "swap 0.05 SOL to USDC to build a fee buffer", "take profit on X, up 140% today", "X has $3k liquidity: selling more than a few dollars will move the price"). Base every idea on the numbers given; quote them. If an idea is a trade or swap, say they can ask you to propose it.
Rules: under 180 words. Never invent prices or holdings. These are ideas, not financial advice; say so in at most a few words at the end. Never tell them to buy unknown airdropped tokens or to interact with them.`;

function fallbackText(p: Portfolio, prev: Brief | null) {
  const top = p.holdings
    .filter((h) => h.usdValue !== null && h.usdValue > 0)
    .slice(0, 3)
    .map((h) => `${h.symbol} $${h.usdValue}${h.pct !== null ? ` (${h.pct}%)` : ""}`)
    .join(", ");
  const change = prev?.totalUsd != null ? ` (${p.totalUsd - prev.totalUsd >= 0 ? "+" : ""}$${(p.totalUsd - prev.totalUsd).toFixed(2)} since last brief)` : "";
  return [
    `Snapshot: $${p.totalUsd}${change}. ${top || "No priced holdings."}`,
    `Allocation: SOL ${p.solPct}%, stablecoins ${p.stablePct}%, other tokens ${p.memePct}%.`,
    p.flags.length ? `Watch: ${p.flags.join("; ")}.` : "Watch: nothing flagged.",
    "Ideas: written ideas are temporarily unavailable; ask the agent in the terminal for ideas.",
  ].join("\n");
}

async function writeWithClaude(data: unknown) {
  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  const r = await client.beta.messages.create({
    model: serverEnv.anthropicModel,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Live wallet data (JSON):\n${JSON.stringify(data)}` }],
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  return r.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text.trim())
    .join("\n")
    .trim();
}

/** Builds, stores and logs a brief for the agent's creator. */
export async function generateBrief(agentId: string, source: "scheduled" | "manual"): Promise<Brief> {
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
  if (!agent) throw new EngineError("Agent not found", 404);
  const token = await db.query.tokens.findFirst({ where: eq(schema.tokens.id, agent.tokenId) });
  const ownMint = token?.network === "mainnet" ? token.mint : null;

  const [creator, trading] = await Promise.all([
    analyzePortfolio(agent.creatorWallet, { ownMint, activity: 8 }),
    agent.tradingMode === "autonomous" ? analyzePortfolio(agent.signerPubkey, { ownMint }).catch(() => null) : Promise.resolve(null),
  ]);
  const prev = await db.query.walletBriefs.findFirst({ where: eq(schema.walletBriefs.agentId, agentId), orderBy: [desc(schema.walletBriefs.createdAt)] });
  const prevHoldings = (prev?.data as { holdings?: { symbol: string; usdValue: number | null; amount: number }[] } | undefined)?.holdings;

  const modelInput = {
    creator_wallet: portfolioForModel(creator, 20),
    agent_trading_wallet: trading ? portfolioForModel(trading, 10) : undefined,
    own_coin: token ? { symbol: token.symbol, mint: token.mint, network: token.network } : undefined,
    trading_mode: agent.tradingMode,
    previous_brief: prev
      ? { at: prev.createdAt.toISOString(), total_usd: prev.totalUsd, holdings: prevHoldings?.slice(0, 15).map((h) => ({ symbol: h.symbol, usd_value: h.usdValue, amount: h.amount })) }
      : undefined,
  };

  let content: string;
  if (serverEnv.anthropicApiKey) {
    try {
      content = (await writeWithClaude(modelInput)) || fallbackText(creator, prev ?? null);
    } catch (e) {
      content = `${fallbackText(creator, prev ?? null)}\n(AI write-up unavailable: ${(e as Error).message.slice(0, 120)})`;
    }
  } else content = fallbackText(creator, prev ?? null);

  const [brief] = await db
    .insert(schema.walletBriefs)
    .values({
      agentId,
      source,
      content,
      totalUsd: creator.totalUsd,
      data: {
        wallet: creator.wallet,
        totalUsd: creator.totalUsd,
        allocation: { sol: creator.solPct, stable: creator.stablePct, other: creator.memePct },
        flags: creator.flags,
        holdings: creator.holdings.slice(0, 30).map((h) => ({ symbol: h.symbol, mint: h.mint, amount: h.amount, usdValue: h.usdValue, pct: h.pct, change24hPct: h.change24hPct })),
        tradingWallet: trading ? { wallet: trading.wallet, totalUsd: trading.totalUsd } : null,
      },
    })
    .returning();
  await db.update(schema.agents).set({ briefLastAt: new Date() }).where(eq(schema.agents.id, agentId));
  await logActivity({ agentId, type: "wallet_brief", status: "info", isPublic: false, message: `Wallet brief ready (${source}): $${creator.totalUsd} total`, data: { briefId: brief.id } });
  return brief;
}

export async function listBriefs(agentId: string, limit = 10) {
  return db.select().from(schema.walletBriefs).where(eq(schema.walletBriefs.agentId, agentId)).orderBy(desc(schema.walletBriefs.createdAt)).limit(limit);
}

export const briefView = (b: Brief) => ({ id: b.id, source: b.source, content: b.content, totalUsd: b.totalUsd, data: b.data, createdAt: b.createdAt.toISOString() });

/**
 * Generates every brief that is due. Each agent is claimed atomically (brief_last_at moved to
 * now before generating), so overlapping runs or several server instances never double up.
 */
export async function runDueBriefs(now = new Date(), max = 5) {
  const candidates = await db
    .select({ id: schema.agents.id, hour: schema.agents.briefHourUtc, last: schema.agents.briefLastAt })
    .from(schema.agents)
    .where(and(eq(schema.agents.briefEnabled, true), eq(schema.agents.status, "active")));
  const results: { agentId: string; ok: boolean; error?: string }[] = [];
  for (const c of candidates) {
    if (results.length >= max) break;
    const since = dueSince(now, c.hour);
    if (!since || (c.last && c.last >= since)) continue;
    const [claimed] = await db
      .update(schema.agents)
      .set({ briefLastAt: now })
      .where(and(eq(schema.agents.id, c.id), or(isNull(schema.agents.briefLastAt), lt(schema.agents.briefLastAt, since))))
      .returning({ id: schema.agents.id });
    if (!claimed) continue;
    try {
      await generateBrief(c.id, "scheduled");
      results.push({ agentId: c.id, ok: true });
    } catch (e) {
      results.push({ agentId: c.id, ok: false, error: (e as Error).message });
      await logActivity({ agentId: c.id, type: "wallet_brief", status: "failed", isPublic: false, message: `Scheduled wallet brief failed: ${(e as Error).message.slice(0, 200)}` }).catch(() => {});
    }
  }
  return results;
}
