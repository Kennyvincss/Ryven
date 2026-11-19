import "server-only";
/**
 * pump.fun launches through PumpPortal's Local Transaction API
 * (https://pumpportal.fun/creation). PumpPortal builds an unsigned v0 transaction; the
 * creator signs it in their own wallet. Because a third party builds a transaction the
 * user will sign, Ryyven validates it strictly before showing it and again before sending.
 */
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { mainnetConnection } from "./solana";
import { outboundFetch } from "./net";
import { PUMP_PROGRAM_ID } from "../shared/config";

const PUMPPORTAL_URL = "https://pumpportal.fun/api/trade-local";

/**
 * Top-level programs a PumpPortal create transaction may call. Observed in real
 * PumpPortal responses (2026-11): ComputeBudget, the pump.fun program, the Associated
 * Token program, and FAdo9NCw… which appears only when a dev buy is included.
 */
export const ALLOWED_CREATE_PROGRAMS = new Set([
  "ComputeBudget111111111111111111111111111111",
  PUMP_PROGRAM_ID,
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe",
  "11111111111111111111111111111111",
]);

export class PumpFunError extends Error {}

export type CreateParams = {
  creator: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  /** Initial "dev buy" in SOL (0 allowed). */
  devBuySol: number;
};

/**
 * Checks that a transaction is exactly a pump.fun create for this creator + mint:
 * v0, two required signers [creator, mint], creator pays fees, the pump.fun program is
 * invoked, and no program outside the allowlist is called.
 */
export function validateCreateTransaction(tx: VersionedTransaction, creator: string, mint: string) {
  const msg = tx.message;
  if (msg.version !== 0) throw new PumpFunError("Unexpected transaction version");
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  if (msg.header.numRequiredSignatures !== 2) throw new PumpFunError("Transaction must require exactly 2 signatures (you + the new mint)");
  if (keys[0] !== creator) throw new PumpFunError("Fee payer is not your wallet");
  if (keys[1] !== mint) throw new PumpFunError("Second signer is not the new coin's mint");
  const programs = new Set(msg.compiledInstructions.map((ix) => keys[ix.programIdIndex]));
  if (!programs.has(PUMP_PROGRAM_ID)) throw new PumpFunError("Transaction does not call the launch program");
  const unknown = [...programs].filter((p) => p === undefined || !ALLOWED_CREATE_PROGRAMS.has(p));
  if (unknown.length) throw new PumpFunError(`Transaction calls an unexpected program: ${unknown.join(", ")}`);
}

/** Asks PumpPortal for the create transaction, validates it and simulates it on mainnet. */
export async function buildCreateTransaction(p: CreateParams): Promise<{ tx: VersionedTransaction; simulationLogs: string[] }> {
  new PublicKey(p.creator);
  new PublicKey(p.mint);
  const res = await outboundFetch(PUMPPORTAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: p.creator,
      action: "create",
      tokenMetadata: { name: p.name, symbol: p.symbol, uri: p.uri },
      mint: p.mint,
      denominatedInSol: "true",
      amount: p.devBuySol,
      slippage: 10,
      priorityFee: 0.00001,
      pool: "pump",
    }),
  });
  if (res.status !== 200) {
    throw new PumpFunError(`PumpPortal could not build the transaction (${res.status} ${res.statusText}): ${(await res.text()).slice(0, 200)}`);
  }
  const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
  validateCreateTransaction(tx, p.creator, p.mint);

  // Dry-run on mainnet so problems (e.g. not enough SOL) show up before the wallet prompt.
  const sim = await mainnetConnection().simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) {
    const logs = sim.value.logs ?? [];
    const text = JSON.stringify(sim.value.err) + " " + logs.join(" ");
    if (/insufficient lamports|InsufficientFunds|"AccountNotFound"|Attempt to debit an account but found no record/i.test(text)) {
      throw new PumpFunError(
        `Your wallet doesn't have enough SOL for this launch${p.devBuySol ? ` (including the ${p.devBuySol} SOL dev buy)` : ""}. Add SOL to your wallet and try again.`,
      );
    }
    throw new PumpFunError(`Simulation failed: ${JSON.stringify(sim.value.err)}. ${logs.slice(-2).join(" ")}`);
  }
  return { tx, simulationLogs: sim.value.logs ?? [] };
}

// ───────────────────────────── trading (buy / sell) ─────────────────────────────

/**
 * Programs a PumpPortal buy/sell may call at the top level. Observed (2026-11): a buy on
 * the pump bonding curve calls ComputeBudget, the Associated Token program and
 * PumpPortal's router (FAdo9NCw…), which CPIs into pump.fun. The pump.fun program, the
 * pump.fun AMM and the token/system programs are also allowed.
 */
/**
 * Lighthouse: an assertion-only program that wallets such as Phantom add to transactions when
 * signing (it makes the transaction fail if balances don't come out as expected). It cannot move
 * funds, so it's allowed; the single-signer check and the spend simulation still apply.
 */
export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

export const ALLOWED_TRADE_PROGRAMS = new Set([
  LIGHTHOUSE_PROGRAM,
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe",
  PUMP_PROGRAM_ID,
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

export type TradeRequest = {
  wallet: string;
  action: "buy" | "sell";
  mint: string;
  /** buy: SOL (decimal). sell: percent of holdings, 1-100. */
  amount: number;
};

/** A trade transaction may only be signed by the trading wallet and call allowlisted programs. */
export function validateTradeTransaction(tx: VersionedTransaction, wallet: string) {
  const msg = tx.message;
  if (msg.version !== 0) throw new PumpFunError("Unexpected transaction version");
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  if (msg.header.numRequiredSignatures !== 1) throw new PumpFunError("Trade must require exactly one signature (the trading wallet)");
  if (keys[0] !== wallet) throw new PumpFunError("Trade fee payer is not the trading wallet");
  const unknown = [...new Set(msg.compiledInstructions.map((ix) => keys[ix.programIdIndex]))].filter((p) => !p || !ALLOWED_TRADE_PROGRAMS.has(p));
  if (unknown.length) throw new PumpFunError(`Trade calls an unexpected program: ${unknown.join(", ")}`);
}

/** "pump" while the coin is on its bonding curve, "pump-amm" (PumpSwap) once it graduated. */
export async function poolFor(mint: string): Promise<"pump" | "pump-amm"> {
  const { readPumpCurve } = await import("./market");
  const curve = await readPumpCurve(mint).catch(() => null);
  if (!curve) throw new PumpFunError("Only bonding-curve coins can be traded here (no bonding curve found for this coin).");
  return curve.complete ? "pump-amm" : "pump";
}

export async function buildTradeTransaction(t: TradeRequest): Promise<VersionedTransaction> {
  new PublicKey(t.wallet);
  new PublicKey(t.mint);
  const pool = await poolFor(t.mint);
  const res = await outboundFetch(PUMPPORTAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: t.wallet,
      action: t.action,
      mint: t.mint,
      amount: t.action === "buy" ? t.amount : `${t.amount}%`,
      denominatedInSol: t.action === "buy" ? "true" : "false",
      slippage: 10,
      priorityFee: 0.00001,
      pool,
    }),
  });
  if (res.status !== 200) {
    const text = (await res.text()).slice(0, 200);
    throw new PumpFunError(
      `PumpPortal could not build the ${t.action} (${res.status} ${res.statusText})${text ? `: ${text}` : ""}. The coin may have no balance to sell, or may have left its bonding curve.`,
    );
  }
  const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
  validateTradeTransaction(tx, t.wallet);
  return tx;
}

/** Fees + rent + rounding allowed on top of the trade amount (0.01 SOL). */
const SPEND_BUFFER_LAMPORTS = 10_000_000n;

/**
 * Simulates on mainnet and measures exactly how many lamports the trading wallet would
 * lose. Refuses if a buy would spend more than amount × (1 + slippage) + fees, or if a
 * sell would cost more than fees. This is what stops a bad or malicious transaction.
 */
export async function simulateSpend(tx: VersionedTransaction, t: TradeRequest): Promise<{ spendLamports: bigint }> {
  const conn = mainnetConnection();
  const wallet = new PublicKey(t.wallet);
  const pre = BigInt(await conn.getBalance(wallet, "confirmed"));
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [t.wallet] },
  });
  if (sim.value.err) {
    const text = JSON.stringify(sim.value.err) + " " + (sim.value.logs ?? []).join(" ");
    if (/insufficient lamports|InsufficientFunds|AccountNotFound|no record of a prior credit/i.test(text)) {
      throw new PumpFunError("The trading wallet doesn't have enough SOL for this trade.");
    }
    throw new PumpFunError(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  }
  const post = BigInt(sim.value.accounts?.[0]?.lamports ?? Number(pre));
  const spend = pre - post;
  const maxSpend =
    t.action === "buy" ? BigInt(Math.ceil(t.amount * 1e9 * 1.1)) + SPEND_BUFFER_LAMPORTS : SPEND_BUFFER_LAMPORTS;
  if (spend > maxSpend) {
    throw new PumpFunError(
      `Refused: simulation shows the wallet would lose ${Number(spend) / 1e9} SOL, more than the allowed ${Number(maxSpend) / 1e9} SOL for this ${t.action}.`,
    );
  }
  return { spendLamports: spend };
}

/** Sends a signed transaction to mainnet and waits (HTTP polling) for confirmation. */
export async function sendAndConfirmMainnet(tx: VersionedTransaction): Promise<string> {
  const conn = mainnetConnection();
  const bs58 = (await import("bs58")).default;
  const signature = bs58.encode(tx.signatures[0]);
  try {
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  } catch (e) {
    const msg = (e as Error).message;
    if (!/already been processed/i.test(msg)) {
      if (/Blockhash not found/i.test(msg)) throw new PumpFunError("The transaction expired before it was sent. Please try again.");
      throw new PumpFunError(`Solana rejected the transaction: ${msg.slice(0, 300)}`);
    }
  }
  for (let i = 0; i < 90; i++) {
    const st = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (st?.err) throw new PumpFunError(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return signature;
    if (i % 5 === 4 && !(await conn.isBlockhashValid(tx.message.recentBlockhash, { commitment: "confirmed" })).value) {
      const again = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (!again) throw new PumpFunError("The transaction expired without landing (nothing was spent).");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new PumpFunError(`Still waiting for confirmation of ${signature}.`);
}

/** Net SOL change (lamports) of the fee payer in a landed transaction. */
export async function solDeltaOf(signature: string): Promise<bigint | null> {
  const tx = await mainnetConnection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta) return null;
  return BigInt(tx.meta.postBalances[0]) - BigInt(tx.meta.preBalances[0]);
}
