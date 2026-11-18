import "server-only";
/**
 * Live portfolio analysis of a Solana mainnet wallet: every holding with name, USD value,
 * allocation, 24h change, liquidity and safety signals (Jupiter token data, falling back to
 * the on-chain pump.fun curve / DexScreener), recent wallet activity, and deterministic risk
 * flags (portfolio-rules.ts). Read-only.
 */
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { mainnetConnection } from "./solana";
import { walletBalances } from "./chain-reads";
import { getMarketData } from "./market";
import { outboundFetch } from "./net";
import { STABLE_SYMBOLS, assessPortfolio, type Assessment, type PricedHolding } from "./portfolio-rules";
import { SOL_MINT, USDT_MINT } from "./jupiter";
import { MAINNET_USDC } from "../shared/config";

const KNOWN_STABLES = new Set([MAINNET_USDC, USDT_MINT]);

type JupToken = {
  id: string;
  name?: string;
  symbol?: string;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  isVerified?: boolean;
  launchpad?: string;
  bondingCurve?: number | null;
  graduatedPool?: string | null;
  stats24h?: { priceChange?: number };
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number };
};

/** Jupiter token data for up to 100 mints per request (cached 60s). */
const tokenCache = new Map<string, { at: number; t: JupToken | null }>();
async function jupTokens(mints: string[]): Promise<Map<string, JupToken>> {
  const out = new Map<string, JupToken>();
  const missing: string[] = [];
  for (const m of mints) {
    const c = tokenCache.get(m);
    if (c && Date.now() - c.at < 60_000) {
      if (c.t) out.set(m, c.t);
    } else missing.push(m);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const res = await outboundFetch(`https://lite-api.jup.ag/tokens/v2/search?query=${chunk.join(",")}`, { headers: { accept: "application/json" } });
      const list = res.ok ? ((await res.json()) as JupToken[]) : [];
      const byId = new Map(list.map((t) => [t.id, t]));
      for (const m of chunk) {
        const t = byId.get(m) ?? null;
        tokenCache.set(m, { at: Date.now(), t });
        if (t) out.set(m, t);
      }
    } catch {
      // leave these unpriced; the fallback below may still price them
    }
  }
  return out;
}

export type WalletActivity = {
  signature: string;
  time: string | null;
  kind: "swap" | "received" | "sent" | "other" | "failed";
  solChange: number;
  tokenChanges: { mint: string; symbol: string; change: number }[];
};

async function recentActivity(wallet: string, symbols: Map<string, string>, limit: number): Promise<WalletActivity[]> {
  const conn = mainnetConnection();
  const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet), { limit }, "confirmed");
  const txs: (ParsedTransactionWithMeta | null)[] = [];
  for (const s of sigs) {
    // one at a time: public RPCs reject large batches
    txs.push(await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null));
  }
  return sigs.map((s, i) => {
    const tx = txs[i];
    const time = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null;
    if (s.err) return { signature: s.signature, time, kind: "failed" as const, solChange: 0, tokenChanges: [] };
    if (!tx?.meta) return { signature: s.signature, time, kind: "other" as const, solChange: 0, tokenChanges: [] };
    const idx = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.toBase58() === wallet);
    const solChange = idx >= 0 ? (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9 : 0;
    const bal = (list: typeof tx.meta.postTokenBalances) => {
      const m = new Map<string, number>();
      for (const b of list ?? []) if (b.owner === wallet) m.set(b.mint, (m.get(b.mint) ?? 0) + Number(b.uiTokenAmount.uiAmountString ?? 0));
      return m;
    };
    const pre = bal(tx.meta.preTokenBalances);
    const post = bal(tx.meta.postTokenBalances);
    const tokenChanges = [...new Set([...pre.keys(), ...post.keys()])]
      .map((mint) => ({ mint, symbol: symbols.get(mint) ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`, change: (post.get(mint) ?? 0) - (pre.get(mint) ?? 0) }))
      .filter((c) => Math.abs(c.change) > 0);
    // SOL moves below ~0.0001 are fees/rent noise
    const ups = tokenChanges.filter((c) => c.change > 0).length + (solChange > 0.0001 ? 1 : 0);
    const downs = tokenChanges.filter((c) => c.change < 0).length + (solChange < -0.0001 ? 1 : 0);
    const kind = ups > 0 && downs > 0 ? "swap" : ups > 0 ? "received" : downs > 0 ? "sent" : "other";
    return { signature: s.signature, time, kind, solChange: Math.round(solChange * 1e6) / 1e6, tokenChanges };
  });
}

export type Portfolio = Assessment & {
  wallet: string;
  network: "mainnet";
  sol: number;
  solUsd: number | null;
  activity: WalletActivity[] | null;
  generatedAt: string;
  sources: string[];
};

/** Full analysis of a mainnet wallet. `ownMint` marks the agent's own coin. */
export async function analyzePortfolio(wallet: string, opts: { ownMint?: string | null; activity?: number } = {}): Promise<Portfolio> {
  const b = await walletBalances(wallet, mainnetConnection());
  const mints = [SOL_MINT, ...b.tokens.map((t) => t.mint).filter((m) => m !== SOL_MINT)].slice(0, 200);
  const info = await jupTokens(mints);
  const solPrice = info.get(SOL_MINT)?.usdPrice ?? null;

  const toHolding = (mint: string, amount: number): PricedHolding => {
    const t = info.get(mint);
    return {
      mint,
      symbol: mint === SOL_MINT ? "SOL" : (t?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`),
      name: t?.name ?? null,
      amount,
      usdPrice: t?.usdPrice ?? null,
      change24hPct: t?.stats24h?.priceChange ?? null,
      liquidityUsd: t?.liquidity ?? null,
      mcapUsd: t?.mcap ?? null,
      verified: t?.isVerified ?? null,
      launchpad: t?.launchpad ?? null,
      onBondingCurve: t?.launchpad === "pump.fun" && !t?.graduatedPool,
      mintAuthorityDisabled: t?.audit?.mintAuthorityDisabled ?? null,
      freezeAuthorityDisabled: t?.audit?.freezeAuthorityDisabled ?? null,
      topHoldersPct: t?.audit?.topHoldersPercentage ?? null,
      isOwnCoin: !!opts.ownMint && mint === opts.ownMint,
      stable: KNOWN_STABLES.has(mint) || (t?.isVerified === true && STABLE_SYMBOLS.has((t.symbol ?? "").toUpperCase())),
    };
  };

  // One row per mint (a wallet can hold a token in several accounts); native + wrapped SOL together.
  const byMint = new Map<string, number>([[SOL_MINT, b.sol]]);
  for (const t of b.tokens) byMint.set(t.mint, (byMint.get(t.mint) ?? 0) + Number(t.amount));
  const holdings: PricedHolding[] = [...byMint].map(([mint, amount]) => toHolding(mint, amount));
  // Symbols that collide with another holding (e.g. a fake "USDC") get the mint appended.
  const counts = new Map<string, number>();
  for (const h of holdings) counts.set(h.symbol, (counts.get(h.symbol) ?? 0) + 1);
  for (const h of holdings) if ((counts.get(h.symbol) ?? 0) > 1 && !KNOWN_STABLES.has(h.mint) && h.mint !== SOL_MINT) h.symbol = `${h.symbol} (${h.mint.slice(0, 4)}…)`;

  // Fallback pricing (pump.fun curve on-chain, then DexScreener) for a few unpriced coins.
  const sources = ["Solana mainnet RPC (balances)", "Jupiter token API (prices, liquidity, audit)"];
  const unpriced = holdings.filter((h) => h.usdPrice === null).slice(0, 5);
  if (unpriced.length) sources.push("pump.fun bonding curve / DexScreener (fallback prices)");
  await Promise.all(
    unpriced.map(async (h) => {
      const m = await getMarketData(h.mint).catch(() => null);
      if (m?.priceUsd != null) {
        h.usdPrice = m.priceUsd;
        h.change24hPct ??= m.priceChange24hPct;
        h.liquidityUsd ??= m.liquidityUsd;
        h.mcapUsd ??= m.marketCapUsd;
        if (m.graduated === false) h.onBondingCurve = true;
      }
    }),
  );

  const assessment = assessPortfolio(holdings, b.sol);
  const symbols = new Map(assessment.holdings.map((h) => [h.mint, h.symbol]));
  const activity = opts.activity ? await recentActivity(wallet, symbols, opts.activity).catch(() => null) : null;
  return { ...assessment, wallet, network: "mainnet", sol: b.sol, solUsd: solPrice, activity, generatedAt: new Date().toISOString(), sources };
}

/** Compact form for the model (keeps token usage low on big wallets). */
export function portfolioForModel(p: Portfolio, maxHoldings = 25) {
  return {
    wallet: p.wallet,
    network: p.network,
    total_usd: p.totalUsd,
    sol_balance: p.sol,
    sol_usd: p.solUsd,
    allocation_pct: { sol: p.solPct, stablecoins: p.stablePct, other_tokens: p.memePct },
    largest_non_stable: p.largest,
    portfolio_flags: p.flags,
    holdings: p.holdings.slice(0, maxHoldings).map((h) => ({
      symbol: h.symbol,
      name: h.name,
      mint: h.mint,
      amount: h.amount,
      usd_value: h.usdValue,
      pct: h.pct,
      price_usd: h.usdPrice,
      change_24h_pct: h.change24hPct !== null ? Math.round(h.change24hPct * 10) / 10 : null,
      liquidity_usd: h.liquidityUsd !== null ? Math.round(h.liquidityUsd) : null,
      mcap_usd: h.mcapUsd !== null ? Math.round(h.mcapUsd) : null,
      verified: h.verified,
      own_coin: h.isOwnCoin || undefined,
      flags: h.flags.length ? h.flags : undefined,
    })),
    more_holdings_not_shown: Math.max(0, p.holdings.length - maxHoldings),
    recent_activity: p.activity?.map((a) => ({
      time: a.time,
      kind: a.kind,
      sol_change: a.solChange || undefined,
      token_changes: a.tokenChanges.length ? a.tokenChanges.map((c) => `${c.change > 0 ? "+" : ""}${Math.round(c.change * 1e4) / 1e4} ${c.symbol}`) : undefined,
    })),
    sources: p.sources,
    generated_at: p.generatedAt,
  };
}
