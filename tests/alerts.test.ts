import { describe, expect, it } from "vitest";
import { describeAlert, fmtUsd, isTriggered, resolveAlert } from "../src/lib/server/alert-rules";

describe("price alert rules", () => {
  it("fixed levels: above/below, refused if already past", () => {
    expect(resolveAlert("above", 200, 150)).toEqual({ direction: "above", target: 200 });
    expect(resolveAlert("below", 100, 150)).toEqual({ direction: "below", target: 100 });
    expect(() => resolveAlert("above", 100, 150)).toThrow(/already above/);
    expect(() => resolveAlert("below", 200, 150)).toThrow(/already below/);
    // no current price (illiquid coin): fixed level still allowed
    expect(resolveAlert("above", 1, null).target).toBe(1);
  });
  it("percentage moves become fixed targets from the current value", () => {
    expect(resolveAlert("rises_pct", 100, 0.002)).toEqual({ direction: "above", target: 0.004 });
    expect(resolveAlert("falls_pct", 20, 150).target).toBeCloseTo(120);
    expect(() => resolveAlert("falls_pct", 100, 150)).toThrow(/less than 100%/);
    expect(() => resolveAlert("rises_pct", 50, null)).toThrow(/No current price/);
  });
  it("rejects zero, negative or non-numeric values", () => {
    expect(() => resolveAlert("above", 0, 1)).toThrow(/positive/);
    expect(() => resolveAlert("above", Number.NaN, 1)).toThrow(/positive/);
  });
  it("triggers at or past the target, never without a value", () => {
    expect(isTriggered("above", 200, 200)).toBe(true);
    expect(isTriggered("above", 200, 199.99)).toBe(false);
    expect(isTriggered("below", 100, 99)).toBe(true);
    expect(isTriggered("below", 100, 101)).toBe(false);
    expect(isTriggered("below", 100, null)).toBe(false);
  });
  it("formats and describes alerts", () => {
    expect(fmtUsd(1_250_000)).toBe("$1.25M");
    expect(fmtUsd(152.3)).toBe("$152.30");
    expect(fmtUsd(0.0000123456)).toBe("$0.0000123");
    expect(describeAlert({ symbol: "SOL", metric: "price", direction: "below", target: 120, condition: "falls 20%" })).toBe("SOL price below $120.00 (falls 20%)");
    expect(describeAlert({ symbol: "RYV", metric: "market_cap", direction: "above", target: 1e6, condition: "above $1.00M" })).toBe("RYV market cap above $1.00M");
  });
});
