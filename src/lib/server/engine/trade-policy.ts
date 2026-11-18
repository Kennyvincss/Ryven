/**
 * Deterministic trading policy (pure, unit-tested). Decides whether the agent may trade.
 * The LLM never decides this, and has no tool to change any of these limits.
 */
import type { PolicyCheck, PolicyRecord } from "../db/schema";

export type TradingPolicy = {
  agentStatus: "active" | "paused";
  mode: "off" | "proposal" | "autonomous";
  maxSolPerTrade: bigint; // lamports
  dailySol: bigint; // lamports
  mints: string[];
};

export type TradeProposal = {
  action: "buy" | "sell";
  mint: string;
  /** buy: lamports. sell: percent of holdings (1-100). */
  amount: bigint;
};

export type TradeContext = {
  globalPause: boolean;
  /** SOL already spent/reserved on buys today (lamports). */
  spentToday: bigint;
  /** Autonomous mode only: the agent trading wallet's SOL balance (lamports). */
  walletLamports?: bigint | null;
};

const sol = (v: bigint) => `${Number(v) / 1e9} SOL`;
/** Kept in the trading wallet for fees and token-account rent. */
export const FEE_RESERVE_LAMPORTS = 10_000_000n;

export function evaluateTrade(p: TradingPolicy, t: TradeProposal, ctx: TradeContext): PolicyRecord {
  const checks: PolicyCheck[] = [];
  const add = (c: PolicyCheck) => checks.push(c);
  add({ id: "trading_enabled", label: "Trading enabled", passed: p.mode !== "off", detail: p.mode === "off" ? "Trading is off. The creator can turn it on in the agent console → Permissions → pump.fun trading" : `Trading mode: ${p.mode}`, effect: "reject" });
  add({ id: "agent_active", label: "Agent active", passed: p.agentStatus === "active", detail: p.agentStatus === "active" ? "Agent is active" : "Agent is paused", effect: "reject" });
  add({ id: "global_pause", label: "Platform enabled", passed: !ctx.globalPause, detail: ctx.globalPause ? "Platform payments/trading are paused by an administrator" : "Platform kill switch is off", effect: "reject" });
  const allowed = p.mints.includes(t.mint);
  add({ id: "mint_allowed", label: "Coin on the allowlist", passed: allowed, detail: allowed ? "Coin is approved for trading" : "This coin is not on the creator's trading allowlist", effect: "reject" });

  if (t.action === "buy") {
    add({ id: "amount", label: "Valid amount", passed: t.amount > 0n, detail: t.amount > 0n ? sol(t.amount) : "Amount must be greater than zero", effect: "reject" });
    add({ id: "max_per_trade", label: "Within max per trade", passed: t.amount <= p.maxSolPerTrade, detail: `${sol(t.amount)} vs max ${sol(p.maxSolPerTrade)}`, effect: "reject" });
    add({
      id: "daily_limit",
      label: "Within daily SOL limit",
      passed: ctx.spentToday + t.amount <= p.dailySol,
      detail: `${sol(ctx.spentToday)} spent today + ${sol(t.amount)} vs limit ${sol(p.dailySol)}`,
      effect: "reject",
    });
    if (p.mode === "autonomous") {
      const need = t.amount + FEE_RESERVE_LAMPORTS;
      const have = ctx.walletLamports ?? null;
      add({
        id: "wallet_balance",
        label: "Trading wallet funded",
        passed: have !== null && have >= need,
        detail: have === null ? "Could not read the trading wallet on mainnet" : `${sol(have)} in wallet, ${sol(need)} needed incl. fees`,
        effect: "reject",
      });
    }
  } else {
    const ok = t.amount >= 1n && t.amount <= 100n;
    add({ id: "percent", label: "Valid sell size", passed: ok, detail: ok ? `Sell ${t.amount}% of holdings` : "Sell size must be 1–100%", effect: "reject" });
  }

  const failed = checks.filter((c) => !c.passed);
  // When trading is off, that's the only thing worth saying.
  if (p.mode === "off") return { decision: "reject", summary: failed[0].detail, checks };
  if (failed.length) return { decision: "reject", summary: failed.map((c) => c.detail).join("; "), checks };
  return { decision: p.mode === "proposal" ? "needs_approval" : "approve", summary: p.mode === "proposal" ? "Passed policy; waiting for the creator to sign" : "All trading checks passed", checks };
}
