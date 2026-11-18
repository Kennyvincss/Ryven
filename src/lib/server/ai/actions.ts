import "server-only";
/**
 * Turns "the engine needs the creator for this" into a one-click action the console pops up
 * (approve, sign, enable, fund, add…), instead of telling the creator where to go.
 * Actions only open a dialog; every change still goes through the normal creator-only API
 * and the creator's own wallet.
 */
import { schema } from "../db";
import { fromBaseUnits } from "../../shared/amounts";
import { BASE_SWAP_MINTS } from "../jupiter";

type Payment = typeof schema.payments.$inferSelect;
type Trade = typeof schema.agentTrades.$inferSelect;
type Asset = "usdc" | "sol" | "token";

export type ConsoleAction =
  | { kind: "approve_payment"; key: string; paymentId: string; title: string; reason: string }
  | { kind: "sign_trade"; key: string; tradeId: string; title: string; reason: string }
  | { kind: "enable_trading"; key: string; title: string; reason: string }
  | { kind: "allow_coins"; key: string; mints: string[]; title: string; reason: string }
  | { kind: "raise_trade_limits"; key: string; neededSol: string; title: string; reason: string }
  | { kind: "fund_trading_wallet"; key: string; address: string; neededSol: string; title: string; reason: string }
  | { kind: "enable_asset"; key: string; asset: "sol" | "token"; title: string; reason: string }
  | { kind: "fund_treasury"; key: string; asset: Asset; title: string; reason: string }
  | { kind: "add_contributor"; key: string; wallet: string; title: string; reason: string }
  | { kind: "raise_payment_limits"; key: string; asset: Asset; title: string; reason: string }
  | { kind: "resume_agent"; key: string; title: string; reason: string };

type Check = { id: string; passed: boolean; detail: string };
const failed = (checks: Check[] | undefined, id: string) => checks?.find((c) => c.id === id && !c.passed);
const assetName = (a: Asset, symbol?: string | null) => (a === "usdc" ? "USDC" : a === "sol" ? "SOL" : `$${symbol ?? "token"}`);

export function actionsForPayment(p: Payment): ConsoleAction[] {
  const checks = (p.policy as { checks?: Check[] } | null)?.checks;
  const asset = p.asset as Asset;
  const out: ConsoleAction[] = [];
  const amount = `${fromBaseUnits(p.amount, p.decimals)} ${assetName(asset, p.symbol)}`;
  if (p.status === "awaiting_approval") {
    out.push({ kind: "approve_payment", key: `pay:${p.id}`, paymentId: p.id, title: `Approve ${amount}?`, reason: `“${p.reason}” → ${p.recipient.slice(0, 4)}…${p.recipient.slice(-4)}` });
  }
  if (p.status !== "rejected" && p.status !== "failed") return out;
  if (failed(checks, "agent_active")) out.push({ kind: "resume_agent", key: "resume", title: "Resume the agent?", reason: "The agent is paused, so it can't pay." });
  if (failed(checks, "asset_enabled") && asset !== "usdc") {
    out.push({ kind: "enable_asset", key: `enable:${asset}`, asset, title: asset === "sol" ? "Enable SOL payments?" : "Enable rewards in your coin?", reason: "This payment type is turned off." });
  }
  const fund = failed(checks, "delegate") || failed(checks, "allowance") || failed(checks, "balance");
  if (fund) out.push({ kind: "fund_treasury", key: `fund:${asset}`, asset, title: `Fund the ${assetName(asset, p.symbol)} treasury?`, reason: fund.detail });
  if (failed(checks, "recipient_allowlist")) {
    out.push({ kind: "add_contributor", key: `contrib:${p.recipient}`, wallet: p.recipient, title: "Add this wallet as an approved contributor?", reason: `${p.recipient.slice(0, 4)}…${p.recipient.slice(-4)} isn't an approved contributor.` });
  }
  const lim = failed(checks, "max_per_tx") || failed(checks, "daily_limit");
  if (lim) out.push({ kind: "raise_payment_limits", key: `limits:${asset}`, asset, title: `Raise your ${assetName(asset, p.symbol)} limits?`, reason: lim.detail });
  return out;
}

export function actionsForTrade(t: Trade, agent: { signerPubkey: string }): ConsoleAction[] {
  const checks = (t.policy as { checks?: Check[] } | null)?.checks;
  const out: ConsoleAction[] = [];
  if (t.status === "awaiting_signature") {
    out.push({ kind: "sign_trade", key: `trade:${t.id}`, tradeId: t.id, title: t.action === "swap" ? "Sign this swap?" : `Sign this ${t.action}?`, reason: t.reason });
    return out;
  }
  if (t.status !== "rejected") return out;
  if (failed(checks, "agent_active")) out.push({ kind: "resume_agent", key: "resume", title: "Resume the agent?", reason: "The agent is paused, so it can't trade." });
  if (failed(checks, "trading_enabled")) out.push({ kind: "enable_trading", key: "enable:trading", title: "Turn on trading?", reason: "Trading is off for this agent." });
  if (failed(checks, "mint_allowed")) {
    const mints = [t.mint, t.inputMint].filter((m): m is string => !!m && !BASE_SWAP_MINTS.includes(m));
    if (mints.length) out.push({ kind: "allow_coins", key: `allow:${mints.join(",")}`, mints, title: "Allow trading this coin?", reason: "It isn't on your trading allowlist." });
  }
  const lim = failed(checks, "max_per_trade") || failed(checks, "daily_limit");
  if (lim) out.push({ kind: "raise_trade_limits", key: "limits:trading", neededSol: fromBaseUnits(t.amount, 9), title: "Raise your trading limits?", reason: lim.detail });
  const wb = failed(checks, "wallet_balance");
  if (wb) out.push({ kind: "fund_trading_wallet", key: "fund:trading", address: agent.signerPubkey, neededSol: fromBaseUnits(t.amount + 10_000_000n, 9), title: "Fund the agent's trading wallet?", reason: wb.detail });
  return out;
}
