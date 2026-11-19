import "server-only";
/**
 * Token swaps on Solana mainnet through Jupiter (aggregator). Jupiter builds a v0
 * transaction for the swapping wallet; Ryyven validates it (single signer, top-level
 * program allowlist) and simulates it to measure exactly how much of the input token and
 * of SOL would leave the wallet before anything is signed.
 * Shape verified against lite-api.jup.ag (2026-11): ComputeBudget, Associated Token,
 * System, Token, Jupiter v6 router. DEX programs run as CPIs inside the router.
 */
import { PublicKey, VersionedTransaction, type ParsedAccountData } from "@solana/web3.js";
import { AccountLayout, ACCOUNT_SIZE, NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { mainnetConnection } from "./solana";
import { outboundFetch } from "./net";
import { MAINNET_USDC } from "../shared/config";

const JUP = "https://lite-api.jup.ag/swap/v1";
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const ALLOWED_SWAP_PROGRAMS = new Set(["ComputeBudget111111111111111111111111111111", ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022, JUPITER_PROGRAM]);

export const SOL_MINT = NATIVE_MINT.toBase58();
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
/** Always swappable (besides the creator's allowlist and the agent's own coin). */
export const BASE_SWAP_MINTS = [SOL_MINT, MAINNET_USDC, USDT_MINT];
const SYMBOLS: Record<string, string> = { [SOL_MINT]: "SOL", [MAINNET_USDC]: "USDC", [USDT_MINT]: "USDT" };

export class SwapError extends Error {}

/** "SOL" / "USDC" / "USDT" or a mint address -> mint address. */
export function resolveMint(input: string): string {
  const v = input.trim();
  const bySymbol = Object.entries(SYMBOLS).find(([, sym]) => sym.toLowerCase() === v.toLowerCase());
  if (bySymbol) return bySymbol[0];
  try {
    return new PublicKey(v).toBase58();
  } catch {
    throw new SwapError(`"${input}" is not a known token (SOL, USDC, USDT) or a valid mint address`);
  }
}

export const symbolOf = (mint: string) => SYMBOLS[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;

export async function mintInfo(mint: string): Promise<{ decimals: number; programId: PublicKey }> {
  if (mint === SOL_MINT) return { decimals: 9, programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") };
  const acc = await mainnetConnection().getParsedAccountInfo(new PublicKey(mint), "confirmed");
  const data = acc.value?.data as ParsedAccountData | undefined;
  if (!acc.value || data?.parsed?.type !== "mint") throw new SwapError(`${mint} is not a token on Solana`);
  return { decimals: data.parsed.info.decimals as number, programId: acc.value.owner };
}

export type Quote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  swapUsdValue?: string;
  routePlan: { swapInfo: { label: string } }[];
  [k: string]: unknown;
};

export async function getQuote(inputMint: string, outputMint: string, amountRaw: bigint, slippageBps = 100): Promise<Quote> {
  if (inputMint === outputMint) throw new SwapError("Input and output tokens are the same");
  const url = `${JUP}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${slippageBps}`;
  const res = await outboundFetch(url, { headers: { accept: "application/json" } });
  const j = (await res.json().catch(() => null)) as (Quote & { error?: string }) | null;
  if (res.status === 429) throw new SwapError("Swap routing is busy right now. Try again in a few seconds.");
  if (!res.ok || !j || !j.outAmount) throw new SwapError(`No swap route found${j?.error ? `: ${j.error}` : ""}`);
  return j;
}

export function validateSwapTransaction(tx: VersionedTransaction, wallet: string) {
  const msg = tx.message;
  if (msg.version !== 0) throw new SwapError("Unexpected transaction version");
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  if (msg.header.numRequiredSignatures !== 1) throw new SwapError("Swap must require exactly one signature (the swapping wallet)");
  if (keys[0] !== wallet) throw new SwapError("Swap fee payer is not the swapping wallet");
  const programs = new Set(msg.compiledInstructions.map((ix) => keys[ix.programIdIndex]));
  if (!programs.has(JUPITER_PROGRAM)) throw new SwapError("Transaction does not use the Jupiter router");
  const unknown = [...programs].filter((p) => !p || !ALLOWED_SWAP_PROGRAMS.has(p));
  if (unknown.length) throw new SwapError(`Swap calls an unexpected program: ${unknown.join(", ")}`);

  // Outside the router, System/Token/ATA instructions may only wrap or unwrap the wallet's
  // OWN SOL: no top-level transfer can send anything to someone else.
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, new PublicKey(wallet)).toBase58();
  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const acc = (i: number) => (ix.accountKeyIndexes[i] !== undefined ? keys[ix.accountKeyIndexes[i]] : undefined);
    const d = ix.data;
    if (program === SYSTEM_PROGRAM) {
      const isTransfer = d.length === 12 && Buffer.from(d).readUInt32LE(0) === 2;
      if (!isTransfer || acc(0) !== wallet || acc(1) !== wsolAta) throw new SwapError("Swap contains a SOL transfer that isn't wrapping the wallet's own SOL");
    } else if (program === TOKEN_PROGRAM || program === TOKEN_2022) {
      const ok = (d.length === 1 && d[0] === 17 && acc(0) === wsolAta) || (d.length === 1 && d[0] === 9 && acc(0) === wsolAta && acc(1) === wallet && acc(2) === wallet);
      if (!ok) throw new SwapError("Swap contains a token instruction outside the Jupiter router");
    } else if (program === ATA_PROGRAM) {
      const ok = (d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1))) && acc(0) === wallet && acc(2) === wallet;
      if (!ok) throw new SwapError("Swap creates a token account for someone other than the wallet");
    }
  }
}

/** Upper bound on the priority fee a swap may pay (0.001 SOL), so it lands quickly in busy markets. */
export const MAX_PRIORITY_FEE_LAMPORTS = 1_000_000;

export async function buildSwapTransaction(quote: Quote, wallet: string, opts: { priority?: boolean } = {}): Promise<VersionedTransaction> {
  return (await buildSwapTransactionWithMeta(quote, wallet, opts)).tx;
}

/** Same, plus the blockhash expiry height (for confirming by polling). */
export async function buildSwapTransactionWithMeta(quote: Quote, wallet: string, opts: { priority?: boolean } = {}): Promise<{ tx: VersionedTransaction; lastValidBlockHeight: number | null }> {
  const res = await outboundFetch(`${JUP}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      ...(opts.priority ? { prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: MAX_PRIORITY_FEE_LAMPORTS, priorityLevel: "veryHigh" } } } : {}),
    }),
  });
  const j = (await res.json().catch(() => null)) as { swapTransaction?: string; lastValidBlockHeight?: number; error?: string } | null;
  if (res.status === 429) throw new SwapError("Swap routing is busy right now. Try again in a few seconds.");
  if (!res.ok || !j?.swapTransaction) {
    console.error(`Jupiter /swap answered ${res.status}`, j?.error ?? "");
    throw new SwapError(`Jupiter could not build the swap${j?.error ? `: ${j.error}` : ""}`);
  }
  const tx = VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
  validateSwapTransaction(tx, wallet);
  return { tx, lastValidBlockHeight: typeof j.lastValidBlockHeight === "number" ? j.lastValidBlockHeight : null };
}

/** Fees + rent for new token accounts (0.01 SOL). */
const SWAP_SOL_BUFFER = 10_000_000n;

/**
 * Simulates on mainnet and refuses if the wallet would lose more input token than the
 * quote's inAmount, or more SOL than (inAmount if swapping SOL) + fees.
 */
export async function simulateSwapSpend(tx: VersionedTransaction, wallet: string, quote: Quote): Promise<void> {
  const conn = mainnetConnection();
  const owner = new PublicKey(wallet);
  const inputIsSol = quote.inputMint === SOL_MINT;
  const { programId } = await mintInfo(quote.inputMint);
  const inputAta = getAssociatedTokenAddressSync(new PublicKey(quote.inputMint), owner, false, programId);
  const watched = inputIsSol ? [wallet] : [wallet, inputAta.toBase58()];
  const [preLamports, preInput] = await Promise.all([
    conn.getBalance(owner, "confirmed").then(BigInt),
    inputIsSol ? Promise.resolve(0n) : conn.getTokenAccountBalance(inputAta, "confirmed").then((b) => BigInt(b.value.amount)).catch(() => 0n),
  ]);
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: watched },
  });
  if (sim.value.err) {
    const text = JSON.stringify(sim.value.err) + " " + (sim.value.logs ?? []).join(" ");
    if (/insufficient lamports|InsufficientFunds|insufficient funds|AccountNotFound|no record of a prior credit/i.test(text)) {
      throw new SwapError("The swapping wallet doesn't have enough of the input token (or SOL for fees).");
    }
    throw new SwapError(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  }
  const accts = sim.value.accounts ?? [];
  const postLamports = BigInt(accts[0]?.lamports ?? Number(preLamports));
  const solSpent = preLamports - postLamports;
  const inAmount = BigInt(quote.inAmount);
  const maxSol = (inputIsSol ? inAmount : 0n) + SWAP_SOL_BUFFER;
  if (solSpent > maxSol) throw new SwapError(`Refused: the wallet would lose ${Number(solSpent) / 1e9} SOL, more than allowed for this swap.`);
  if (!inputIsSol) {
    const acc = accts[1];
    const data = acc?.data?.[0] ? Buffer.from(acc.data[0], "base64") : null;
    const postInput = data && data.length >= ACCOUNT_SIZE ? AccountLayout.decode(data.subarray(0, ACCOUNT_SIZE)).amount : 0n;
    if (preInput - postInput > inAmount) throw new SwapError("Refused: the swap would spend more of the input token than quoted.");
  }
}

