import "server-only";
/**
 * pump.fun launches through PumpPortal's Local Transaction API
 * (https://pumpportal.fun/creation). PumpPortal builds an unsigned v0 transaction; the
 * creator signs it in their own wallet. Because a third party builds a transaction the
 * user will sign, Ryven validates it strictly before showing it and again before sending.
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
  if (!programs.has(PUMP_PROGRAM_ID)) throw new PumpFunError("Transaction does not call the pump.fun program");
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
        `Your wallet doesn't have enough mainnet SOL for this launch${p.devBuySol ? ` (including the ${p.devBuySol} SOL dev buy)` : ""}. Add SOL to your wallet on Solana mainnet and try again.`,
      );
    }
    throw new PumpFunError(`Mainnet simulation failed: ${JSON.stringify(sim.value.err)}. ${logs.slice(-2).join(" ")}`);
  }
  return { tx, simulationLogs: sim.value.logs ?? [] };
}
