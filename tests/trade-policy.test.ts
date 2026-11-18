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

  describe("swaps", () => {
    const SOLM = "So11111111111111111111111111111111111111112";
    const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const swapBase: TradingPolicy = { ...base, swapMints: [mint, SOLM, USDC] };
    const swap = (inputMint: string, out: string, value: number) => ({ action: "swap" as const, mint: out, amount: SOL(value), inputMint, inputIsSol: inputMint === SOLM });

    it("approves a SOL → USDC swap within limits", () => {
      expect(evaluateTrade(swapBase, swap(SOLM, USDC, 0.05), ctx).decision).toBe("approve");
    });
    it("requires the creator's signature in proposal mode", () => {
      expect(evaluateTrade({ ...swapBase, mode: "proposal" }, swap(USDC, SOLM, 0.05), ctx).decision).toBe("needs_approval");
    });
    it("rejects tokens outside SOL/USDC/USDT, the own coin and the allowlist", () => {
      const random = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
      expect(evaluateTrade(swapBase, swap(SOLM, random, 0.01), ctx).decision).toBe("reject");
      expect(evaluateTrade(swapBase, swap(random, USDC, 0.01), ctx).decision).toBe("reject");
      expect(evaluateTrade(swapBase, { action: "swap", mint: USDC, amount: SOL(0.01), inputMint: null }, ctx).decision).toBe("reject");
    });
    it("applies max-per-trade and the daily limit to the swap's SOL value", () => {
      expect(evaluateTrade(swapBase, swap(USDC, SOLM, 0.2), ctx).decision).toBe("reject");
      expect(evaluateTrade(swapBase, swap(USDC, SOLM, 0.1), { ...ctx, spentToday: SOL(0.45) }).decision).toBe("reject");
    });
    it("only needs SOL in the wallet for the amount when SOL is the input", () => {
      const poor = { ...ctx, walletLamports: SOL(0.02) };
      expect(evaluateTrade(swapBase, swap(SOLM, USDC, 0.05), poor).decision).toBe("reject");
      expect(evaluateTrade(swapBase, swap(USDC, SOLM, 0.05), poor).decision).toBe("approve");
    });
    it("is rejected when trading is off", () => {
      expect(evaluateTrade({ ...swapBase, mode: "off" }, swap(SOLM, USDC, 0.01), ctx).decision).toBe("reject");
    });
  });
});
