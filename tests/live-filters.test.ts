import { describe, expect, it } from "vitest";
import { activeCount, cleanFilter, parseShort, passes, upstreamQuery, type FilterableCoin } from "../src/lib/shared/live-filters";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const coin = (p: Partial<FilterableCoin> = {}): FilterableCoin => ({
  createdAt: "2026-11-18T11:30:00Z", // 30 minutes old
  mcap: 50_000,
  volume24h: 20_000,
  liquidity: 10_000,
  holders: 150,
  bondingCurve: 60,
  topHoldersPct: 25,
  devPct: 2,
  sniperPct: 5,
  twitter: null,
  website: null,
  telegram: null,
  ...p,
});

describe("live filters", () => {
  it("parses shorthand amounts", () => {
    expect(parseShort("10k")).toBe(10_000);
    expect(parseShort("1.5m")).toBe(1_500_000);
    expect(parseShort("$2,500")).toBe(2_500);
    expect(parseShort("2B")).toBe(2e9);
    expect(parseShort("")).toBeUndefined();
    expect(parseShort("abc")).toBeUndefined();
  });
  it("sanitises untrusted filter input", () => {
    expect(cleanFilter({ mcapMin: 1000, mcapMax: -5, volumeMin: "9", ageMax: Infinity, socials: "yes", evil: 1 })).toEqual({ mcapMin: 1000 });
    expect(cleanFilter(null)).toEqual({});
    expect(activeCount({ mcapMin: 1, holdersMax: 2, socials: true })).toBe(3);
  });
  it("applies every range, inclusive", () => {
    expect(passes(coin(), { mcapMin: 50_000, mcapMax: 50_000 }, NOW)).toBe(true);
    expect(passes(coin(), { mcapMin: 60_000 }, NOW)).toBe(false);
    expect(passes(coin(), { ageMax: 20 }, NOW)).toBe(false);
    expect(passes(coin(), { ageMin: 10, ageMax: 40 }, NOW)).toBe(true);
    expect(passes(coin(), { volumeMin: 25_000 }, NOW)).toBe(false);
    expect(passes(coin(), { holdersMax: 100 }, NOW)).toBe(false);
    expect(passes(coin(), { top10Max: 20 }, NOW)).toBe(false);
    expect(passes(coin(), { devMax: 1 }, NOW)).toBe(false);
    expect(passes(coin(), { snipersMax: 10 }, NOW)).toBe(true);
  });
  it("unknown values fail minimums but not maximums", () => {
    expect(passes(coin({ mcap: null }), { mcapMin: 1 }, NOW)).toBe(false);
    expect(passes(coin({ mcap: null }), { mcapMax: 1 }, NOW)).toBe(true);
  });
  it("curve bounds ignore graduated coins; socials needs at least one link", () => {
    expect(passes(coin({ bondingCurve: null }), { curveMin: 90 }, NOW)).toBe(true);
    expect(passes(coin(), { curveMin: 90 }, NOW)).toBe(false);
    expect(passes(coin(), { socials: true }, NOW)).toBe(false);
    expect(passes(coin({ telegram: "https://t.me/x" }), { socials: true }, NOW)).toBe(true);
  });
  it("maps the upstream-supported filters only", () => {
    expect(upstreamQuery({ mcapMin: 1, ageMax: 60, curveMin: 80, top10Max: 30, devMax: 5, socials: true })).toEqual({ minMcap: 1, maxTokenAge: 60, minBondingCurve: 80, maxTopHoldersPercentage: 30 });
  });
});
