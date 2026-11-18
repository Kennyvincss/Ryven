/**
 * Live-terminal column filters, shared by the browser (form) and the server (query + checks).
 * Pure: no I/O. Ranges are inclusive; a missing bound means "no limit".
 */

export type LiveColumn = "newPairs" | "aboutToGraduate" | "graduated";

export type ColumnFilter = {
  /** token age, minutes */
  ageMin?: number;
  ageMax?: number;
  mcapMin?: number;
  mcapMax?: number;
  /** 24h volume, USD */
  volumeMin?: number;
  volumeMax?: number;
  liquidityMin?: number;
  liquidityMax?: number;
  holdersMin?: number;
  holdersMax?: number;
  /** bonding curve progress, % */
  curveMin?: number;
  curveMax?: number;
  top10Max?: number;
  devMax?: number;
  snipersMax?: number;
  /** at least one of X / website / Telegram */
  socials?: boolean;
};
export type PulseFilters = Partial<Record<LiveColumn, ColumnFilter>>;

export type RangeField = { id: string; label: string; unit: "usd" | "minutes" | "count" | "pct"; min?: keyof ColumnFilter; max?: keyof ColumnFilter; columns?: LiveColumn[] };

/** Form layout (also the list of numeric keys). */
export const FILTER_FIELDS: RangeField[] = [
  { id: "age", label: "Token age (minutes)", unit: "minutes", min: "ageMin", max: "ageMax" },
  { id: "mcap", label: "Market cap ($)", unit: "usd", min: "mcapMin", max: "mcapMax" },
  { id: "volume", label: "Volume 24h ($)", unit: "usd", min: "volumeMin", max: "volumeMax" },
  { id: "liquidity", label: "Liquidity ($)", unit: "usd", min: "liquidityMin", max: "liquidityMax" },
  { id: "holders", label: "Holders", unit: "count", min: "holdersMin", max: "holdersMax" },
  { id: "curve", label: "Bonding curve (%)", unit: "pct", min: "curveMin", max: "curveMax", columns: ["newPairs", "aboutToGraduate"] },
  { id: "top10", label: "Top 10 holders max (%)", unit: "pct", max: "top10Max" },
  { id: "dev", label: "Dev holding max (%)", unit: "pct", max: "devMax" },
  { id: "snipers", label: "Snipers max (%)", unit: "pct", max: "snipersMax" },
];

const NUMERIC_KEYS = FILTER_FIELDS.flatMap((f) => [f.min, f.max]).filter(Boolean) as (keyof ColumnFilter)[];

/** Keeps only finite, non-negative numbers (and socials=true); drops everything else. */
export function cleanFilter(f: unknown): ColumnFilter {
  if (!f || typeof f !== "object") return {};
  const src = f as Record<string, unknown>;
  const out: ColumnFilter = {};
  for (const k of NUMERIC_KEYS) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e13) (out as Record<string, number>)[k] = v;
  }
  if (src.socials === true) out.socials = true;
  return out;
}

export function activeCount(f: ColumnFilter | undefined): number {
  if (!f) return 0;
  return NUMERIC_KEYS.filter((k) => typeof f[k] === "number").length + (f.socials ? 1 : 0);
}

/** "10k" -> 10000, "1.5m" -> 1500000, "2b" -> 2e9, "" -> undefined. */
export function parseShort(v: string): number | undefined {
  const m = v.trim().toLowerCase().replace(/[$,\s]/g, "").match(/^(\d*\.?\d+)([kmb])?$/);
  if (!m) return undefined;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Number(m[1]) * mult;
}

/** The coin fields a filter looks at. */
export type FilterableCoin = {
  createdAt: string | null;
  mcap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  holders: number | null;
  bondingCurve: number | null;
  topHoldersPct: number | null;
  devPct: number | null;
  sniperPct: number | null;
  twitter: string | null;
  website: string | null;
  telegram: string | null;
};

/** Does a coin pass the filter? Unknown values only fail a bound that requires a minimum. */
export function passes(c: FilterableCoin, f: ColumnFilter, now = Date.now()): boolean {
  const ageMin = c.createdAt ? (now - Date.parse(c.createdAt)) / 60000 : null;
  const range = (v: number | null, min?: number, max?: number) => {
    if (min !== undefined && (v === null || v < min)) return false;
    if (max !== undefined && v !== null && v > max) return false;
    return true;
  };
  return (
    range(ageMin, f.ageMin, f.ageMax) &&
    range(c.mcap, f.mcapMin, f.mcapMax) &&
    range(c.volume24h, f.volumeMin, f.volumeMax) &&
    range(c.liquidity, f.liquidityMin, f.liquidityMax) &&
    range(c.holders, f.holdersMin, f.holdersMax) &&
    // graduated coins have no curve: curve bounds don't apply to them
    (c.bondingCurve === null || range(c.bondingCurve, f.curveMin, f.curveMax)) &&
    range(c.topHoldersPct, undefined, f.top10Max) &&
    range(c.devPct, undefined, f.devMax) &&
    range(c.sniperPct, undefined, f.snipersMax) &&
    (!f.socials || !!(c.twitter || c.website || c.telegram))
  );
}

/** Upstream (Jupiter) query fields for the filters it supports itself; the rest is applied by `passes`. */
export function upstreamQuery(f: ColumnFilter): Record<string, number> {
  const map: [keyof ColumnFilter, string][] = [
    ["ageMin", "minTokenAge"],
    ["ageMax", "maxTokenAge"],
    ["mcapMin", "minMcap"],
    ["mcapMax", "maxMcap"],
    ["volumeMin", "minVolume24h"],
    ["volumeMax", "maxVolume24h"],
    ["liquidityMin", "minLiquidity"],
    ["liquidityMax", "maxLiquidity"],
    ["holdersMin", "minHolderCount"],
    ["holdersMax", "maxHolderCount"],
    ["curveMin", "minBondingCurve"],
    ["curveMax", "maxBondingCurve"],
    ["top10Max", "maxTopHoldersPercentage"],
  ];
  const out: Record<string, number> = {};
  for (const [k, q] of map) if (typeof f[k] === "number") out[q] = f[k] as number;
  return out;
}
