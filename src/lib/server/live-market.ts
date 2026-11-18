import "server-only";
/**
 * Live pump.fun market data for the Live terminal, charts and token pages. Source: Jupiter's
 * data API (the feed behind jup.ag's own terminal), with Jupiter's public token API as a
 * fallback for new pairs. Responses are cached for a few seconds and shared by all viewers,
 * so traffic to the data source doesn't grow with the number of visitors. Read-only.
 */
import { outboundFetch } from "./net";

const DATAPI = "https://datapi.jup.ag";
const LITE = "https://lite-api.jup.ag";

type Stats = { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number; numTraders?: number; numNetBuyers?: number; holderChange?: number };
type RawAsset = {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  dev?: string;
  circSupply?: number;
  launchpad?: string;
  createdAt?: string;
  holderCount?: number;
  mcap?: number;
  fdv?: number;
  usdPrice?: number;
  liquidity?: number;
  twitter?: string;
  website?: string;
  telegram?: string;
  graduatedAt?: string;
  graduatedPool?: string;
  bondingCurve?: number;
  organicScoreLabel?: string;
  isVerified?: boolean;
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; devBalancePercentage?: number; sniperPct?: number; botHoldersPercentage?: number };
  stats5m?: Stats;
  stats1h?: Stats;
  stats6h?: Stats;
  stats24h?: Stats;
};
type RawPool = { id: string; createdAt?: string; bondingCurve?: number; liquidity?: number; volume24h?: number; baseAsset: RawAsset };

export type LiveCoin = {
  mint: string;
  name: string;
  symbol: string;
  icon: string | null;
  decimals: number | null;
  createdAt: string | null;
  graduatedAt: string | null;
  /** 0-100, null once graduated */
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

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const vol = (s?: Stats) => (s ? (num(s.buyVolume) ?? 0) + (num(s.sellVolume) ?? 0) : null);
/** Only http(s) links reach the browser. */
const link = (v?: string) => (v && /^https?:\/\//i.test(v) ? v : null);

export function toLiveCoin(a: RawAsset, pool?: Partial<RawPool>): LiveCoin {
  const graduated = !!(a.graduatedAt || a.graduatedPool);
  const curve = num(pool?.bondingCurve ?? a.bondingCurve);
  return {
    mint: a.id,
    name: (a.name ?? "").slice(0, 60) || "Unknown",
    symbol: (a.symbol ?? "").slice(0, 20) || "???",
    icon: link(a.icon),
    decimals: num(a.decimals),
    createdAt: a.createdAt ?? pool?.createdAt ?? null,
    graduatedAt: a.graduatedAt ?? null,
    bondingCurve: graduated ? null : curve !== null ? Math.min(100, Math.max(0, curve)) : null,
    mcap: num(a.mcap),
    priceUsd: num(a.usdPrice),
    liquidity: num(pool?.liquidity ?? a.liquidity),
    volume1h: vol(a.stats1h),
    volume24h: num(pool?.volume24h) ?? vol(a.stats24h),
    change5m: num(a.stats5m?.priceChange),
    change1h: num(a.stats1h?.priceChange),
    buys1h: num(a.stats1h?.numBuys),
    sells1h: num(a.stats1h?.numSells),
    holders: num(a.holderCount),
    topHoldersPct: num(a.audit?.topHoldersPercentage),
    devPct: num(a.audit?.devBalancePercentage),
    sniperPct: num(a.audit?.sniperPct),
    mintAuthorityDisabled: a.audit?.mintAuthorityDisabled ?? null,
    freezeAuthorityDisabled: a.audit?.freezeAuthorityDisabled ?? null,
    organic: a.organicScoreLabel ?? null,
    twitter: link(a.twitter),
    website: link(a.website),
    telegram: link(a.telegram),
    dev: a.dev ?? null,
  };
}

/** Tiny shared TTL cache (per server instance) that also de-duplicates concurrent fetches. */
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
  return value;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await outboundFetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`Market data source answered ${res.status}`);
  return (await res.json()) as T;
}

export type Pulse = { newPairs: LiveCoin[]; aboutToGraduate: LiveCoin[]; graduated: LiveCoin[]; updatedAt: string; partial: boolean };

/** The three live columns: new pump.fun pairs, coins close to graduating, and just graduated. */
export function getPulse(): Promise<Pulse> {
  return cached("pulse", 2_500, async () => {
    try {
      const body = { recent: { launchpads: ["pump.fun"] }, aboutToGraduate: { launchpads: ["pump.fun"] }, graduated: { launchpads: ["pump.fun"] } };
      const d = await getJson<Record<"recent" | "aboutToGraduate" | "graduated", { pools?: RawPool[] }>>(`${DATAPI}/v1/pools/gems`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const map = (k: "recent" | "aboutToGraduate" | "graduated") => (d[k]?.pools ?? []).filter((p) => p?.baseAsset?.id).map((p) => toLiveCoin(p.baseAsset, p));
      return { newPairs: map("recent"), aboutToGraduate: map("aboutToGraduate"), graduated: map("graduated"), updatedAt: new Date().toISOString(), partial: false };
    } catch (e) {
      console.error("Live feed (gems) unavailable, using fallback:", (e as Error).message);
      const recent = await getJson<RawAsset[]>(`${LITE}/tokens/v2/recent`).catch(() => [] as RawAsset[]);
      const pump = recent.filter((a) => a.launchpad === "pump.fun").map((a) => toLiveCoin(a));
      return { newPairs: pump, aboutToGraduate: [], graduated: [], updatedAt: new Date().toISOString(), partial: true };
    }
  });
}

/** Token header data for any mint (name, icon, price, market cap, curve, holders, safety). */
export function getLiveToken(mint: string): Promise<LiveCoin | null> {
  return cached(`token:${mint}`, 4_000, async () => {
    const list = await getJson<RawAsset[]>(`${LITE}/tokens/v2/search?query=${mint}`);
    const a = list.find((t) => t.id === mint);
    return a ? toLiveCoin(a) : null;
  });
}

export const CHART_INTERVALS = { "1s": "1_SECOND", "15s": "15_SECOND", "1m": "1_MINUTE", "5m": "5_MINUTE", "15m": "15_MINUTE", "1h": "1_HOUR", "4h": "4_HOUR", "1d": "1_DAY" } as const;
export type ChartInterval = keyof typeof CHART_INTERVALS;
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** OHLCV candles in USD, by price or by market cap. */
export function getCandles(mint: string, interval: ChartInterval, kind: "price" | "mcap", candles = 300): Promise<Candle[]> {
  const n = Math.min(Math.max(candles, 10), 500);
  return cached(`chart:${mint}:${interval}:${kind}:${n}`, interval === "1s" || interval === "15s" ? 1_500 : 4_000, async () => {
    const url = `${DATAPI}/v2/charts/${mint}?interval=${CHART_INTERVALS[interval]}&to=${Date.now()}&candles=${n}&type=${kind}&quote=usd`;
    const d = await getJson<{ candles?: Candle[] }>(url);
    return (d.candles ?? [])
      .filter((c) => [c.time, c.open, c.high, c.low, c.close].every((v) => typeof v === "number" && Number.isFinite(v)))
      .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: num(c.volume) ?? 0 }))
      .sort((a, b) => a.time - b.time);
  });
}

export type LiveTrade = { signature: string; time: string; side: "buy" | "sell"; usd: number | null; sol: number | null; amount: number | null; priceUsd: number | null; trader: string };

/** Latest trades of a token, newest first. */
export function getTrades(mint: string, limit = 40): Promise<LiveTrade[]> {
  return cached(`trades:${mint}:${limit}`, 2_000, async () => {
    const d = await getJson<{ txs?: { txHash: string; timestamp: string; type: string; usdVolume?: number; nativeVolume?: number; amount?: number; usdPrice?: number; traderAddress: string }[] }>(
      `${DATAPI}/v1/txs/${mint}?limit=${Math.min(limit, 100)}`,
    );
    return (d.txs ?? [])
      .filter((t) => t.type === "buy" || t.type === "sell")
      .map((t) => ({
        signature: t.txHash,
        time: t.timestamp,
        side: t.type as "buy" | "sell",
        usd: num(t.usdVolume),
        sol: num(t.nativeVolume),
        amount: num(t.amount),
        priceUsd: num(t.usdPrice),
        trader: t.traderAddress,
      }));
  });
}

export type ActivityWindow = { buys: number | null; sells: number | null; buyVolumeUsd: number | null; sellVolumeUsd: number | null; traders: number | null; netBuyers: number | null; priceChangePct: number | null };
export type TradingActivity = { mint: string; symbol: string; windows: Record<"5m" | "1h" | "6h" | "24h", ActivityWindow>; recentTrades: LiveTrade[] };

/** Buys, sells, volume and traders over 5m / 1h / 6h / 24h, plus the latest trades. */
export async function getTradingActivity(mint: string): Promise<TradingActivity | null> {
  const [list, recentTrades] = await Promise.all([
    cached(`raw:${mint}`, 4_000, () => getJson<RawAsset[]>(`${LITE}/tokens/v2/search?query=${mint}`)),
    getTrades(mint, 30).catch(() => [] as LiveTrade[]),
  ]);
  const a = list.find((t) => t.id === mint);
  if (!a) return null;
  const w = (s?: Stats): ActivityWindow => ({
    buys: num(s?.numBuys),
    sells: num(s?.numSells),
    buyVolumeUsd: num(s?.buyVolume),
    sellVolumeUsd: num(s?.sellVolume),
    traders: num(s?.numTraders),
    netBuyers: num(s?.numNetBuyers),
    priceChangePct: num(s?.priceChange),
  });
  return { mint, symbol: a.symbol ?? "", windows: { "5m": w(a.stats5m), "1h": w(a.stats1h), "6h": w(a.stats6h), "24h": w(a.stats24h) }, recentTrades };
}
