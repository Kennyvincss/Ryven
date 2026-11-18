import { describe, expect, it } from "vitest";
import { actionsForPayment, actionsForTrade } from "../src/lib/server/ai/actions";

process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; // the db module is imported for types only

const check = (id: string, passed = false, detail = `${id} failed`) => ({ id, passed, detail, label: id });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payment = (p: Record<string, unknown>): any => ({
  id: "pay-1",
  asset: "usdc",
  amount: 5_000_000n,
  decimals: 6,
  symbol: "USDC",
  recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  reason: "Weekly reward",
  status: "rejected",
  policy: { checks: [] },
  ...p,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trade = (t: Record<string, unknown>): any => ({
  id: "trade-1",
  action: "buy",
  mint: "CoinMint111111111111111111111111111111111111",
  inputMint: null,
  amount: 50_000_000n,
  reason: "Momentum",
  status: "rejected",
  policy: { checks: [] },
  ...t,
});
const kinds = (a: { kind: string }[]) => a.map((x) => x.kind);
const agent = { signerPubkey: "AgentSigner11111111111111111111111111111111" };

describe("console actions from payments", () => {
  it("approval needed → approve popup only", () => {
    expect(kinds(actionsForPayment(payment({ status: "awaiting_approval" })))).toEqual(["approve_payment"]);
  });
  it("maps each failed check to its fix", () => {
    const p = payment({ asset: "sol", policy: { checks: [check("asset_enabled"), check("allowance"), check("recipient_allowlist"), check("daily_limit"), check("agent_active")] } });
    expect(kinds(actionsForPayment(p))).toEqual(["resume_agent", "enable_asset", "fund_treasury", "add_contributor", "raise_payment_limits"]);
  });
  it("USDC is always enabled; passed checks and confirmed payments produce nothing", () => {
    expect(kinds(actionsForPayment(payment({ policy: { checks: [check("asset_enabled")] } })))).toEqual([]);
    expect(kinds(actionsForPayment(payment({ policy: { checks: [check("balance", true)] } })))).toEqual([]);
    expect(actionsForPayment(payment({ status: "confirmed", policy: { checks: [check("balance")] } }))).toEqual([]);
  });
});

describe("console actions from trades", () => {
  it("proposal waiting → sign popup", () => {
    const a = actionsForTrade(trade({ status: "awaiting_signature" }), agent);
    expect(kinds(a)).toEqual(["sign_trade"]);
  });
  it("trading off, coin not allowed, limit and wallet balance", () => {
    const t = trade({ policy: { checks: [check("trading_enabled"), check("mint_allowed"), check("max_per_trade"), check("wallet_balance")] } });
    const a = actionsForTrade(t, agent);
    expect(kinds(a)).toEqual(["enable_trading", "allow_coins", "raise_trade_limits", "fund_trading_wallet"]);
    expect(a.find((x) => x.kind === "allow_coins")).toMatchObject({ mints: ["CoinMint111111111111111111111111111111111111"] });
    expect(a.find((x) => x.kind === "raise_trade_limits")).toMatchObject({ neededSol: "0.05" });
    expect(a.find((x) => x.kind === "fund_trading_wallet")).toMatchObject({ address: agent.signerPubkey, neededSol: "0.06" });
  });
  it("swaps never ask to allowlist SOL/USDC/USDT", () => {
    const t = trade({ action: "swap", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", inputMint: "So11111111111111111111111111111111111111112", policy: { checks: [check("mint_allowed")] } });
    expect(actionsForTrade(t, agent)).toEqual([]);
  });
});
