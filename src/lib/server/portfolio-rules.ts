/**
 * Pure portfolio maths and risk flags (no I/O, unit-tested). The portfolio analyser feeds it
 * live balances and market data; the agent turns the result into ideas.
 */

export const STABLE_SYMBOLS = new Set(["USDC", "USDT", "PYUSD", "USDS", "USDG", "FDUSD", "USD1"]);

export type PricedHolding = {
  mint: string;
  symbol: string;
  name: string | null;
  amount: number;
  usdPrice: number | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  mcapUsd: number | null;
  verified: boolean | null;
  launchpad: string | null;
  /** pump.fun coin still on its bonding curve */
  onBondingCurve?: boolean;
  mintAuthorityDisabled?: boolean | null;
  freezeAuthorityDisabled?: boolean | null;
  topHoldersPct?: number | null;
  isOwnCoin?: boolean;
  /** Set by the caller from the mint (never trust a symbol alone: anyone can name a token "USDC"). */
  stable?: boolean;
};

export type AssessedHolding = PricedHolding & { usdValue: number | null; pct: number | null; flags: string[] };

export type Assessment = {
  totalUsd: number;
  stablePct: number;
  solPct: number;
  memePct: number;
  largest: { symbol: string; pct: number } | null;
  holdings: AssessedHolding[];
  unpricedCount: number;
  dustCount: number;
  flags: string[];
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const LOW_LIQUIDITY_USD = 10_000;
export const DUST_USD = 1;
export const MIN_SOL_FOR_FEES = 0.01;

/** Values every holding, computes allocation and raises deterministic risk flags. */
export function assessPortfolio(holdings: PricedHolding[], solBalance: number): Assessment {
  const valued = holdings.map((h) => ({ ...h, usdValue: h.usdPrice !== null ? h.amount * h.usdPrice : null }));
  const totalUsd = valued.reduce((s, h) => s + (h.usdValue ?? 0), 0);
  const isStable = (h: PricedHolding) => h.stable ?? STABLE_SYMBOLS.has(h.symbol.toUpperCase());
  const isSol = (h: PricedHolding) => h.symbol === "SOL";

  const out: AssessedHolding[] = valued
    .map((h) => {
      const pct = totalUsd > 0 && h.usdValue !== null ? (h.usdValue / totalUsd) * 100 : null;
      const flags: string[] = [];
      if (h.usdPrice === null) flags.push("no market price found (possibly illiquid or a scam airdrop)");
      if (!isStable(h) && !isSol(h)) {
        if (h.liquidityUsd !== null && h.liquidityUsd < LOW_LIQUIDITY_USD) flags.push(`low liquidity ($${Math.round(h.liquidityUsd).toLocaleString("en-US")}): hard to sell without moving the price`);
        if (h.change24hPct !== null && h.change24hPct <= -30) flags.push(`down ${round(-h.change24hPct, 1)}% in 24h`);
        if (h.change24hPct !== null && h.change24hPct >= 100) flags.push(`up ${round(h.change24hPct, 1)}% in 24h: consider taking some profit`);
        if (h.mintAuthorityDisabled === false) flags.push("mint authority still enabled: supply can be inflated");
        if (h.freezeAuthorityDisabled === false) flags.push("freeze authority still enabled: tokens can be frozen");
        if (h.topHoldersPct != null && h.topHoldersPct >= 50) flags.push(`top holders own ${round(h.topHoldersPct, 1)}% of supply`);
        if (h.onBondingCurve) flags.push("still on the pump.fun bonding curve (not graduated)");
      }
      if (h.usdValue !== null && h.usdValue < DUST_USD) flags.push("dust (< $1)");
      return { ...h, usdValue: h.usdValue !== null ? round(h.usdValue) : null, pct: pct !== null ? round(pct, 1) : null, flags };
    })
    .sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));

  const sumPct = (f: (h: PricedHolding) => boolean) => round(out.filter(f).reduce((s, h) => s + (h.pct ?? 0), 0), 1);
  const stablePct = sumPct(isStable);
  const solPct = sumPct(isSol);
  const memePct = sumPct((h) => !isStable(h) && !isSol(h));
  const top = out.find((h) => h.usdValue !== null && !isStable(h));
  const largest = top && top.pct !== null ? { symbol: top.symbol, pct: top.pct } : null;
  const unpricedCount = out.filter((h) => h.usdPrice === null).length;
  const dustCount = out.filter((h) => h.usdValue !== null && h.usdValue < DUST_USD).length;

  const flags: string[] = [];
  if (solBalance < MIN_SOL_FOR_FEES) flags.push(`only ${solBalance} SOL: not enough to pay network fees reliably (keep at least ${MIN_SOL_FOR_FEES} SOL)`);
  if (largest && largest.pct >= 50 && largest.symbol !== "SOL") flags.push(`concentrated: ${largest.pct}% of the portfolio is in ${largest.symbol}`);
  if (totalUsd > 0 && memePct >= 70) flags.push(`${memePct}% is in volatile tokens (not SOL or stablecoins)`);
  if (totalUsd > 0 && stablePct === 0 && memePct > 0) flags.push("no stablecoin buffer");
  if (dustCount >= 3) flags.push(`${dustCount} dust holdings (< $1): burning them and closing their token accounts would reclaim ~0.002 SOL rent each`);
  if (unpricedCount > 0) flags.push(`${unpricedCount} token(s) with no market price: don't interact with unknown airdropped tokens`);

  return { totalUsd: round(totalUsd), stablePct, solPct, memePct, largest, holdings: out, unpricedCount, dustCount, flags };
}
