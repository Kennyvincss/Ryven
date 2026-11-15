/**
 * The ONLY transaction shape an agent signer is ever allowed to sign for payments:
 *   1. create recipient's token account (ATA) if missing (paid by the platform fee payer)
 *   2. TransferChecked(treasury -> recipient ATA, amount) with the agent as DELEGATE
 *   3. Memo "ryven:pay:<paymentId>" for on-chain traceability
 * Works for the USDC treasury (SPL Token) and the agent's own token (Token-2022).
 * There is deliberately no generic "sign this transaction" function for payments.
 */
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createMemoInstruction } from "@solana/spl-memo";
import { PublicKey, Transaction } from "@solana/web3.js";
import { USDC_DECIMALS } from "../shared/config";

export type AgentPaymentParams = {
  paymentId: string;
  feePayer: PublicKey;
  agentSigner: PublicKey;
  treasury: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  amount: bigint;
  recentBlockhash: string;
  /** Token program of the mint (SPL Token for USDC, Token-2022 for Ryven tokens). */
  programId?: PublicKey;
  decimals?: number;
  /** Memo is always included in production; tests on runtimes without the Memo program may omit it. */
  includeMemo?: boolean;
};

export const paymentMemo = (paymentId: string) => `ryven:pay:${paymentId}`;

export function buildAgentPaymentTransaction(p: AgentPaymentParams): Transaction {
  if (p.amount <= 0n) throw new Error("Payment amount must be positive");
  // Recipients must be normal wallets (on-curve). PDAs / program accounts are refused.
  if (!PublicKey.isOnCurve(p.recipient.toBytes())) throw new Error("Recipient must be a wallet address (on-curve)");
  const programId = p.programId ?? TOKEN_PROGRAM_ID;
  const decimals = p.decimals ?? USDC_DECIMALS;
  const recipientAta = getAssociatedTokenAddressSync(p.mint, p.recipient, false, programId);
  const tx = new Transaction({ feePayer: p.feePayer, recentBlockhash: p.recentBlockhash });
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(p.feePayer, recipientAta, p.recipient, p.mint, programId),
    createTransferCheckedInstruction(p.treasury, p.mint, recipientAta, p.agentSigner, p.amount, decimals, [], programId),
  );
  if (p.includeMemo !== false) tx.add(createMemoInstruction(paymentMemo(p.paymentId), [p.agentSigner]));
  return tx;
}
