import "server-only";
/**
 * Market data for any Solana token (read-only).
 *
 * 1. pump.fun coins still on their bonding curve: price & market cap computed from the
 *    curve account ON-CHAIN (no third party). Layout verified against mainnet:
 *    [8 disc][u64 virtual_token][u64 virtual_sol][u64 real_token][u64 real_sol][u64 supply][bool complete][32 creator]
 * 2. SOL/USD from Pyth's on-chain price feed (verified owner + feed id + freshness).
 * 3. Coins trading on a DEX (graduated pump.fun coins, others): DexScreener public API.
 */
import { PublicKey, type Connection } from "@solana/web3.js";
import { mainnetConnection } from "./solana";
import { outboundFetch } from "./net";
import { PUMP_PROGRAM_ID } from "../shared/config";

const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const PYTH_SOL_USD_ACCOUNT = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
const PYTH_SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
/** Tokens a fresh pump.fun curve can sell before graduating (793.1M with 6 decimals). */
const PUMP_INITIAL_REAL_TOKENS = 793_100_000_000_000n;

export type PumpCurve = {
  address: string;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
};

export async function readPumpCurve(mint: string, conn: Connection = mainnetConnection()): Promise<PumpCurve | null> {
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PUMP_PROGRAM_ID));
  const info = await conn.getAccountInfo(curve, "confirmed");
  if (!info || info.owner.toBase58() !== PUMP_PROGRAM_ID || info.data.length < 49) return null;
  const d = info.data;
  return {
    address: curve.toBase58(),
    virtualTokenReserves: d.readBigUInt64LE(8),
    virtualSolReserves: d.readBigUInt64LE(16),
    realTokenReserves: d.readBigUInt64LE(24),
    realSolReserves: d.readBigUInt64LE(32),
    tokenTotalSupply: d.readBigUInt64LE(40),
    complete: d[48] === 1,
  };
}

let solCache: { at: number; value: SolUsd } | null = null;
type SolUsd = { price: number; confidence: number; publishedAt: string; stale: boolean };

/** SOL/USD from Pyth's verified on-chain feed (cached 20s). */
export async function solUsd(conn: Connection = mainnetConnection()): Promise<SolUsd | null> {
  if (solCache && Date.now() - solCache.at < 20_000) return solCache.value;
  const acc = await conn.getAccountInfo(new PublicKey(PYTH_SOL_USD_ACCOUNT), "confirmed");
  if (!acc || acc.owner.toBase58() !== PYTH_RECEIVER) return null;
  const d = acc.data;
  let o = 8 + 32;
  o += d[o] === 0 ? 2 : 1; // verification level enum
  if (d.subarray(o, o + 32).toString("hex") !== PYTH_SOL_USD_FEED) return null;
  o += 32;
  const price = d.readBigInt64LE(o);
  const conf = d.readBigUInt64LE(o + 8);
  const expo = d.readInt32LE(o + 16);
  const publish = Number(d.readBigInt64LE(o + 20));
  const value = {
    price: Number(price) * 10 ** expo,
    confidence: Number(conf) * 10 ** expo,
    publishedAt: new Date(publish * 1000).toISOString(),
    stale: Date.now() / 1000 - publish > 120,
  };
  solCache = { at: Date.now(), value };
  return value;
}

type DexPair = {
  dexId: string;
  url: string;
  pairAddress: string;
  priceNative?: string;
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number };
  priceChange?: { h1?: number; h24?: number };
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { symbol: string };
};

/** Best (most liquid) DexScreener pair where the token is the base asset. */
export async function dexScreener(mint: string): Promise<DexPair | null> {
  try {
    const res = await outboundFetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { pairs?: DexPair[] | null };
    const pairs = (j.pairs ?? []).filter((p) => p.baseToken?.address === mint);
    if (!pairs.length) return null;
    return pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  } catch {
    return null;
  }
}

export type MarketData = {
  mint: string;
  source: "bonding curve (on-chain)" | "dexscreener" | "none";
  priceSol: number | null;
  priceUsd: number | null;
  marketCapSol: number | null;
  marketCapUsd: number | null;
  /** pump.fun curve only: % of the curve's tokens sold (100% = graduated). */
  bondingCurveProgress: number | null;
  graduated: boolean | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  solUsd: number | null;
  venue: string | null;
  url: string | null;
  note?: string;
};

/** Live market data for a mainnet token. Never throws: returns what it could determine. */
export async function getMarketData(mint: string): Promise<MarketData> {
  new PublicKey(mint);
  const [curve, sol, dex] = await Promise.all([
    readPumpCurve(mint).catch(() => null),
    solUsd().catch(() => null),
    dexScreener(mint),
  ]);
  const base: MarketData = {
    mint,
    source: "none",
    priceSol: null,
    priceUsd: null,
    marketCapSol: null,
    marketCapUsd: null,
    bondingCurveProgress: null,
    graduated: null,
    liquidityUsd: dex?.liquidity?.usd ?? null,
    volume24hUsd: dex?.volume?.h24 ?? null,
    priceChange24hPct: dex?.priceChange?.h24 ?? null,
    solUsd: sol?.price ?? null,
    venue: dex?.dexId ?? null,
    url: dex?.url ?? null,
  };

  if (curve && !curve.complete && curve.virtualTokenReserves > 0n) {
    // 6-decimal tokens, 9-decimal SOL.
    const priceSol = Number(curve.virtualSolReserves) / 1e9 / (Number(curve.virtualTokenReserves) / 1e6);
    const supply = Number(curve.tokenTotalSupply) / 1e6;
    const sold = PUMP_INITIAL_REAL_TOKENS > curve.realTokenReserves ? PUMP_INITIAL_REAL_TOKENS - curve.realTokenReserves : 0n;
    return {
      ...base,
      source: "bonding curve (on-chain)",
      priceSol,
      priceUsd: sol ? priceSol * sol.price : null,
      marketCapSol: priceSol * supply,
      marketCapUsd: sol ? priceSol * supply * sol.price : null,
      bondingCurveProgress: Math.min(100, Math.round((Number(sold) / Number(PUMP_INITIAL_REAL_TOKENS)) * 10000) / 100),
      graduated: false,
      venue: "pump.fun",
      url: `https://pump.fun/coin/${mint}`,
      note: sol?.stale ? "SOL/USD price from Pyth is more than 2 minutes old" : undefined,
    };
  }

  if (dex) {
    const priceUsd = dex.priceUsd ? Number(dex.priceUsd) : null;
    const quoteIsSol = dex.quoteToken?.symbol === "SOL";
    return {
      ...base,
      source: "dexscreener",
      priceUsd,
      priceSol: quoteIsSol && dex.priceNative ? Number(dex.priceNative) : sol && priceUsd !== null ? priceUsd / sol.price : null,
      marketCapUsd: dex.marketCap ?? dex.fdv ?? null,
      marketCapSol: sol && (dex.marketCap ?? dex.fdv) ? (dex.marketCap ?? dex.fdv)! / sol.price : null,
      graduated: curve ? curve.complete : null,
      bondingCurveProgress: curve?.complete ? 100 : null,
    };
  }

  return {
    ...base,
    graduated: curve ? curve.complete : null,
    note: "No market found: the token has no bonding curve and no DEX pool, so it has no price yet.",
  };
}
