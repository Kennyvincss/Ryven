/**
 * SOL payments with an on-chain cap.
 *
 * Native SOL can't be delegated, so the agent's SOL treasury holds WRAPPED SOL in a token
 * account the CREATOR owns; the agent is a capped delegate on it (same model as USDC).
 * A payment, in ONE atomic transaction:
 *   1. fee payer creates a temporary wrapped-SOL account it owns (rent paid by the fee payer)
 *   2. TransferChecked(treasury -> temp, amount) signed by the agent as DELEGATE (cap enforced by Solana)
 *   3. CloseAccount(temp -> fee payer): unwraps; fee payer gets amount + its rent back
 *   4. SystemProgram.transfer(fee payer -> recipient, amount): recipient receives plain SOL
 *   5. Memo "ryyven:pay:<paymentId>"
 * The fee payer ends up exactly where it started (minus the network fee).
 */
import {
  ACCOUNT_SIZE,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createApproveCheckedInstruction,
  createCloseAccountInstruction,
  createInitializeAccount3Instruction,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { createMemoInstruction } from "@solana/spl-memo";
import { PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { deriveTreasuryAddress, treasurySeed } from "./treasury";
import { paymentMemo } from "./payment";

export const SOL_DECIMALS = 9;
/** Smallest SOL payment: a brand-new wallet must receive at least its rent-exempt minimum. */
export const MIN_SOL_PAYMENT_LAMPORTS = 1_000_000n; // 0.001 SOL

export function buildAgentSolPaymentTransaction(p: {
  paymentId: string;
  feePayer: PublicKey;
  agentSigner: PublicKey;
  treasury: PublicKey;
  recipient: PublicKey;
  lamports: bigint;
  temp: PublicKey;
  tempRentLamports: number;
  recentBlockhash: string;
  includeMemo?: boolean;
}): Transaction {
  if (p.lamports <= 0n) throw new Error("Payment amount must be positive");
  if (!PublicKey.isOnCurve(p.recipient.toBytes())) throw new Error("Recipient must be a wallet address (on-curve)");
  const tx = new Transaction({ feePayer: p.feePayer, recentBlockhash: p.recentBlockhash }).add(
    SystemProgram.createAccount({ fromPubkey: p.feePayer, newAccountPubkey: p.temp, lamports: p.tempRentLamports, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeAccount3Instruction(p.temp, NATIVE_MINT, p.feePayer, TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(p.treasury, NATIVE_MINT, p.temp, p.agentSigner, p.lamports, SOL_DECIMALS, [], TOKEN_PROGRAM_ID),
    createCloseAccountInstruction(p.temp, p.feePayer, p.feePayer, [], TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: p.feePayer, toPubkey: p.recipient, lamports: p.lamports }),
  );
  if (p.includeMemo !== false) tx.add(createMemoInstruction(paymentMemo(p.paymentId), [p.agentSigner]));
  return tx;
}

/**
 * Creator funds the SOL treasury: create + wrap on first use (InitializeAccount on the
 * native mint counts lamports above rent as balance), later deposits transfer + SyncNative,
 * then (re)set the agent's allowance.
 */
export function buildFundSolTreasuryInstructions(p: {
  owner: PublicKey;
  agentId: string;
  agentSigner: PublicKey;
  createAccount: boolean;
  rentLamports: number;
  depositLamports: bigint;
  allowance: bigint | null;
}): TransactionInstruction[] {
  const treasury = deriveTreasuryAddress(p.owner, p.agentId, "sol", TOKEN_PROGRAM_ID);
  const ixs: TransactionInstruction[] = [];
  if (p.createAccount) {
    ixs.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: p.owner,
        basePubkey: p.owner,
        seed: treasurySeed(p.agentId, "sol"),
        newAccountPubkey: treasury,
        lamports: p.rentLamports + Number(p.depositLamports),
        space: ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(treasury, NATIVE_MINT, p.owner, TOKEN_PROGRAM_ID),
    );
  } else if (p.depositLamports > 0n) {
    ixs.push(SystemProgram.transfer({ fromPubkey: p.owner, toPubkey: treasury, lamports: p.depositLamports }), createSyncNativeInstruction(treasury, TOKEN_PROGRAM_ID));
  }
  if (p.allowance !== null) {
    ixs.push(createApproveCheckedInstruction(treasury, NATIVE_MINT, p.agentSigner, p.owner, p.allowance, SOL_DECIMALS, [], TOKEN_PROGRAM_ID));
  }
  return ixs;
}

/** Anyone can top up a SOL treasury: send SOL to it and sync the wrapped balance. */
export function buildDepositSolInstructions(from: PublicKey, treasury: PublicKey, lamports: bigint): TransactionInstruction[] {
  return [SystemProgram.transfer({ fromPubkey: from, toPubkey: treasury, lamports }), createSyncNativeInstruction(treasury, TOKEN_PROGRAM_ID)];
}

/** Creator withdraws plain SOL from the treasury (via a temporary account they own, then unwrap). */
export function buildWithdrawSolInstructions(owner: PublicKey, agentId: string, lamports: bigint, temp: PublicKey, tempRentLamports: number): TransactionInstruction[] {
  const treasury = deriveTreasuryAddress(owner, agentId, "sol", TOKEN_PROGRAM_ID);
  return [
    SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: temp, lamports: tempRentLamports, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeAccount3Instruction(temp, NATIVE_MINT, owner, TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(treasury, NATIVE_MINT, temp, owner, lamports, SOL_DECIMALS, [], TOKEN_PROGRAM_ID),
    createCloseAccountInstruction(temp, owner, owner, [], TOKEN_PROGRAM_ID),
  ];
}
