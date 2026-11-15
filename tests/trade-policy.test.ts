import { describe, expect, it } from "vitest";
import { evaluateTrade, type TradingPolicy } from "../src/lib/server/engine/trade-policy";

const SOL = (n: number) => BigInt(Math.round(n * 1e9));
const mint = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const base: TradingPolicy = { agentStatus: "active", mode: "autonomous", maxSolPerTrade: SOL(0.1), dailySol: SOL(0.5), mints: [mint] };
const ctx = { globalPause: false, spentToday: 0n, walletLamports: SOL(1) };

describe("trade policy", () => {
  it("approves an autonomous buy within limits", () => {
    expect(evaluateTrade(base, { action: "buy", mint, amount: SOL(0.1) }, ctx).decision).toBe("approve");
  });
  it("proposal mode passes policy but requires the creator's signature", () => {
    expect(evaluateTrade({ ...base, mode: "proposal" }, { action: "buy", mint, amount: SOL(0.1) }, ctx).decision).toBe("needs_approval");
  });
  it("rejects when trading is off, the agent is paused or the platform is paused", () => {
    expect(evaluateTrade({ ...base, mode: "off" }, { action: "buy", mint, amount: SOL(0.1) }, ctx).decision).toBe("reject");
    expect(evaluateTrade({ ...base, agentStatus: "paused" }, { action: "buy", mint, amount: SOL(0.1) }, ctx).decision).toBe("reject");
    expect(evaluateTrade(base, { action: "buy", mint, amount: SOL(0.1) }, { ...ctx, globalPause: true }).decision).toBe("reject");
  });
  it("rejects coins not on the allowlist", () => {
    expect(evaluateTrade(base, { action: "buy", mint: "So11111111111111111111111111111111111111112", amount: SOL(0.01) }, ctx).decision).toBe("reject");
  });
  it("enforces max per trade and the daily SOL limit", () => {
    expect(evaluateTrade(base, { action: "buy", mint, amount: SOL(0.11) }, ctx).decision).toBe("reject");
    expect(evaluateTrade(base, { action: "buy", mint, amount: SOL(0.1) }, { ...ctx, spentToday: SOL(0.41) }).decision).toBe("reject");
    expect(evaluateTrade(base, { action: "buy", mint, amount: SOL(0.1) }, { ...ctx, spentToday: SOL(0.4) }).decision).toBe("approve");
  });
  it("autonomous buys need enough SOL in the trading wallet (plus a fee reserve)", () => {
    expect(evaluateTrade(base, { action: "buy", mint, amount: SOL(0.1) }, { ...ctx, walletLamports: SOL(0.105) }).decision).toBe("reject");
    expect(evaluateTrade(base, { action: "buy", mint, amount: SOL(0.1) }, { ...ctx, walletLamports: null }).decision).toBe("reject");
  });
  it("validates sell percentages", () => {
    expect(evaluateTrade(base, { action: "sell", mint, amount: 50n }, ctx).decision).toBe("approve");
    expect(evaluateTrade(base, { action: "sell", mint, amount: 0n }, ctx).decision).toBe("reject");
    expect(evaluateTrade(base, { action: "sell", mint, amount: 101n }, ctx).decision).toBe("reject");
  });
});
