"use client";
/** Shared client types and formatting for the Live terminal, charts and trade box. */

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export type LiveCoin = {
  mint: string;
  name: string;
  symbol: string;
  icon: string | null;
  decimals: number | null;
  createdAt: string | null;
  graduatedAt: string | null;
  bondingCurve: number | null;
  mcap: number | null;
  priceUsd: number | null;
  liquidity: number | null;
  volume1h: number | null;
  volume24h: number | null;
  change5m: number | null;
  change1h: number | null;
  buys1h: number | null;
  sells1h: number | null;
  holders: number | null;
  topHoldersPct: number | null;
  devPct: number | null;
  sniperPct: number | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  organic: string | null;
  twitter: string | null;
  website: string | null;
  telegram: string | null;
  dev: string | null;
};

export type Pulse = { newPairs: LiveCoin[]; aboutToGraduate: LiveCoin[]; graduated: LiveCoin[]; updatedAt: string; partial: boolean };
export type LiveTrade = { signature: string; time: string; side: "buy" | "sell"; usd: number | null; sol: number | null; amount: number | null; priceUsd: number | null; trader: string };
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** $1.2K, $3.45M, $0.0000123 */
export function usd(n: number | null | undefined, opts: { compact?: boolean } = { compact: true }): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (opts.compact !== false && a >= 1000) return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
  if (a >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (a === 0) return "$0";
  return `$${smallNumber(n)}`;
}

/** 0.00001234 -> "0.0₄1234" style subscript zeros for tiny prices. */
export function smallNumber(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) >= 0.001) return Number(n.toPrecision(4)).toString();
  const s = n.toFixed(20);
  const m = s.match(/^(-?)0\.(0+)(\d{1,4})/);
  if (!m) return n.toPrecision(3);
  const zeros = m[2].length;
  const sub = String(zeros)
    .split("")
    .map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)])
    .join("");
  return `${m[1]}0.0${sub}${m[3].replace(/0+$/, "") || "0"}`;
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/** "12s", "4m", "3h", "2d" */
export function age(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Decimal string -> raw base units (exact, no floats). */
export function toRaw(value: string, decimals: number): bigint | null {
  const v = value.trim();
  if (!/^\d*(\.\d*)?$/.test(v) || v === "" || v === ".") return null;
  const [w, f = ""] = v.split(".");
  const frac = f.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

/** Raw base units -> display number (for UI only). */
export function fromRaw(raw: bigint | string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}
