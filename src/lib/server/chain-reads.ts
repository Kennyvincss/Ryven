import "server-only";
/** Read-only Solana lookups shared by the API and the agent's tools. */
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type Connection, PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { connection } from "./solana";

export type Holder = { owner: string; amount: string; percent: number };
export type HolderReport = {
  count: number;
  holders: Holder[];
  /** "index": full scan via an indexed RPC. "history": rebuilt from the mint's recent transactions. */
  source: "index" | "history";
  /** False when the history scan hit its limit, so the list may miss old holders. */
  complete: boolean;
};

const cache = new Map<string, { at: number; report: HolderReport }>();
const MAX_SIGNATURES = 300;

/**
 * All current holders of a mint. Uses getProgramAccounts when the RPC indexes token
 * accounts (Helius, Triton, QuickNode…). The public Solana RPC does not, so we fall back
 * to discovering token accounts from the mint's transaction history and then reading
 * each account's CURRENT balance on-chain.
 */
export async function getHolders(mint: string, programId: PublicKey = TOKEN_2022_PROGRAM_ID, conn: Connection = connection()): Promise<HolderReport> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < 60_000) return hit.report;
  let report: HolderReport;
  try {
    report = await viaIndex(mint, programId, conn);
  } catch {
    report = await viaHistory(mint, conn);
  }
  cache.set(mint, { at: Date.now(), report });
  return report;
}

/** Back-compat helper used by the token page. */
export async function holderCount(mint: string, programId: PublicKey = TOKEN_2022_PROGRAM_ID, conn: Connection = connection()): Promise<number | null> {
  try {
    return (await getHolders(mint, programId, conn)).count;
  } catch {
    return null;
  }
}

async function supplyOf(mint: string, conn: Connection) {
  const s = await conn.getTokenSupply(new PublicKey(mint), "confirmed");
  return Number(s.value.uiAmountString ?? 0);
}

function finish(byOwner: Map<string, number>, supply: number, source: HolderReport["source"], complete: boolean): HolderReport {
  const holders = [...byOwner.entries()]
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([owner, amt]) => ({ owner, amount: amt.toString(), percent: supply > 0 ? Math.round((amt / supply) * 10000) / 100 : 0 }));
  return { count: holders.length, holders, source, complete };
}

async function viaIndex(mint: string, programId: PublicKey, conn: Connection): Promise<HolderReport> {
  const accounts = await conn.getParsedProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: mint } }],
  });
  const byOwner = new Map<string, number>();
  for (const a of accounts) {
    const info = (a.account.data as ParsedAccountData).parsed?.info;
    if (!info) continue;
    byOwner.set(info.owner, (byOwner.get(info.owner) ?? 0) + Number(info.tokenAmount.uiAmountString));
  }
  return finish(byOwner, await supplyOf(mint, conn), "index", true);
}

async function viaHistory(mint: string, conn: Connection): Promise<HolderReport> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(mint), { limit: MAX_SIGNATURES }, "confirmed");
  const tokenAccounts = new Set<string>();
  // Small concurrency to stay under public RPC rate limits.
  for (let i = 0; i < sigs.length; i += 4) {
    const batch = await Promise.all(
      sigs.slice(i, i + 4).map((s) => conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null)),
    );
    for (const tx of batch) {
      if (!tx?.meta) continue;
      const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
      for (const b of [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])]) {
        if (b.mint === mint && keys[b.accountIndex]) tokenAccounts.add(keys[b.accountIndex]);
      }
    }
  }
  // Read the CURRENT balance of every discovered token account.
  const list = [...tokenAccounts].map((a) => new PublicKey(a));
  const byOwner = new Map<string, number>();
  for (let i = 0; i < list.length; i += 100) {
    const infos = await conn.getMultipleParsedAccounts(list.slice(i, i + 100), { commitment: "confirmed" });
    for (const acc of infos.value) {
      const info = (acc?.data as ParsedAccountData | undefined)?.parsed?.info;
      if (!info || info.mint !== mint) continue;
      byOwner.set(info.owner, (byOwner.get(info.owner) ?? 0) + Number(info.tokenAmount.uiAmountString));
    }
  }
  return finish(byOwner, await supplyOf(mint, conn), "history", sigs.length < MAX_SIGNATURES);
}

export type WalletBalances = { wallet: string; sol: number; tokens: { mint: string; amount: string; program: "spl" | "token-2022" }[] };

/** SOL + every non-zero token balance of a wallet. */
export async function walletBalances(wallet: string, conn: Connection = connection()): Promise<WalletBalances> {
  const owner = new PublicKey(wallet);
  const [lamports, spl, t22] = await Promise.all([
    conn.getBalance(owner, "confirmed"),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
  ]);
  const list = (r: typeof spl, program: "spl" | "token-2022") =>
    r.value
      .map((a) => {
        const info = (a.account.data as ParsedAccountData).parsed.info;
        return { mint: info.mint as string, amount: info.tokenAmount.uiAmountString as string, program };
      })
      .filter((t) => Number(t.amount) > 0);
  return { wallet, sol: lamports / 1e9, tokens: [...list(spl, "spl"), ...list(t22, "token-2022")] };
}
