"use client";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { SendTransactionError, type Connection, type Keypair, type Transaction } from "@solana/web3.js";

/**
 * Sends a transaction through the user's wallet (the wallet shows it for approval and
 * signs it), then waits for confirmation. Returns the signature only once confirmed.
 */
export async function sendWalletTransaction(
  wallet: WalletContextState,
  connection: Connection,
  tx: Transaction,
  extraSigners: Keypair[] = [],
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Connect your wallet first");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  let signature: string;
  try {
    signature = await wallet.sendTransaction(tx, connection, { signers: extraSigners, preflightCommitment: "confirmed" });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
  const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(res.value.err)}`);
  return signature;
}

export function friendlyError(e: unknown): string {
  const err = e as Error & { error?: unknown; logs?: string[] };
  const msg = err?.message ?? String(e);
  if (/User rejected|rejected the request|declined/i.test(msg)) return "You rejected the transaction in your wallet.";
  if (e instanceof SendTransactionError || /insufficient/i.test(msg)) {
    if (/insufficient lamports|0x1\b|Attempt to debit/i.test(msg)) return "Not enough SOL in your wallet for fees/rent.";
    if (/insufficient funds/i.test(msg)) return "Insufficient token balance for this transaction.";
  }
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}
