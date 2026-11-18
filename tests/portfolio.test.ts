import { describe, expect, it } from "vitest";
import { assessPortfolio, type PricedHolding } from "../src/lib/server/portfolio-rules";
import { dueSince, isBriefDue } from "../src/lib/server/ai/brief-schedule";

const h = (p: Partial<PricedHolding> & { symbol: string; amount: number; usdPrice: number | null }): PricedHolding => ({
  mint: p.symbol,
  name: null,
  change24hPct: null,
  liquidityUsd: null,
  mcapUsd: null,
  verified: null,
  launchpad: null,
  ...p,
});

describe("portfolio assessment", () => {
  it("values holdings, computes allocation and sorts by value", () => {
    const a = assessPortfolio([h({ symbol: "SOL", amount: 1, usdPrice: 100 }), h({ symbol: "USDC", amount: 100, usdPrice: 1 }), h({ symbol: "MEME", amount: 1000, usdPrice: 0.2, liquidityUsd: 50_000 })], 1);
    expect(a.totalUsd).toBe(400);
    expect(a.solPct).toBe(25);
    expect(a.stablePct).toBe(25);
    expect(a.memePct).toBe(50);
    expect(a.holdings[0].symbol).toBe("MEME");
    expect(a.largest).toEqual({ symbol: "MEME", pct: 50 });
    expect(a.flags.some((f) => f.includes("concentrated"))).toBe(true);
  });
  it("flags low SOL for fees, no stablecoins and volatile-heavy portfolios", () => {
    const a = assessPortfolio([h({ symbol: "SOL", amount: 0.005, usdPrice: 100 }), h({ symbol: "MEME", amount: 100, usdPrice: 1, liquidityUsd: 1e6 })], 0.005);
    expect(a.flags.join("|")).toMatch(/network fees/);
    expect(a.flags.join("|")).toMatch(/no stablecoin buffer/);
    expect(a.flags.join("|")).toMatch(/volatile/);
  });
  it("flags risky tokens: low liquidity, crashes, pumps, authorities, holder concentration, unpriced", () => {
    const a = assessPortfolio(
      [
        h({ symbol: "SOL", amount: 1, usdPrice: 100 }),
        h({ symbol: "THIN", amount: 10, usdPrice: 1, liquidityUsd: 2000 }),
        h({ symbol: "DUMP", amount: 10, usdPrice: 1, change24hPct: -45 }),
        h({ symbol: "PUMP", amount: 10, usdPrice: 1, change24hPct: 150 }),
        h({ symbol: "RUG", amount: 10, usdPrice: 1, mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPct: 80 }),
        h({ symbol: "AIRDROP", amount: 1e6, usdPrice: null }),
      ],
      1,
    );
    const f = (s: string) => a.holdings.find((x) => x.symbol === s)!.flags.join("|");
    expect(f("THIN")).toMatch(/low liquidity/);
    expect(f("DUMP")).toMatch(/down 45%/);
    expect(f("PUMP")).toMatch(/taking some profit/);
    expect(f("RUG")).toMatch(/mint authority/);
    expect(f("RUG")).toMatch(/freeze authority/);
    expect(f("RUG")).toMatch(/top holders own 80%/);
    expect(f("AIRDROP")).toMatch(/no market price/);
    expect(a.unpricedCount).toBe(1);
    expect(a.flags.join("|")).toMatch(/unknown airdropped/);
    expect(f("SOL")).toBe("");
  });
  it("doesn't treat a token as a stablecoin when the caller says it isn't (fake USDC)", () => {
    const a = assessPortfolio([h({ symbol: "SOL", amount: 1, usdPrice: 100 }), h({ symbol: "USDC", amount: 100, usdPrice: 1, stable: false })], 1);
    expect(a.stablePct).toBe(0);
    expect(a.memePct).toBe(50);
  });
  it("counts dust and handles an empty wallet", () => {
    const dust = [1, 2, 3].map((i) => h({ symbol: `D${i}`, amount: 1, usdPrice: 0.1 }));
    expect(assessPortfolio([h({ symbol: "SOL", amount: 1, usdPrice: 100 }), ...dust], 1).dustCount).toBe(3);
    const empty = assessPortfolio([h({ symbol: "SOL", amount: 0, usdPrice: 100 })], 0);
    expect(empty.totalUsd).toBe(0);
    expect(empty.largest).toBeNull();
  });
});

describe("daily brief schedule", () => {
  const at = (iso: string) => new Date(iso);
  it("is due once per day after the chosen UTC hour", () => {
    expect(dueSince(at("2026-11-18T07:59:00Z"), 8)).toBeNull();
    expect(dueSince(at("2026-11-18T08:00:00Z"), 8)?.toISOString()).toBe("2026-11-18T08:00:00.000Z");
    expect(isBriefDue(at("2026-11-18T09:00:00Z"), 8, null)).toBe(true);
    expect(isBriefDue(at("2026-11-18T09:00:00Z"), 8, at("2026-11-17T08:05:00Z"))).toBe(true);
    expect(isBriefDue(at("2026-11-18T09:00:00Z"), 8, at("2026-11-18T08:05:00Z"))).toBe(false);
    expect(isBriefDue(at("2026-11-18T07:00:00Z"), 8, at("2026-11-17T08:05:00Z"))).toBe(false);
  });
});
