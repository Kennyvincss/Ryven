/**
 * Delegated-treasury transaction builders (isomorphic: used by the browser to build
 * creator-signed transactions, and by the server/tests to verify them).
 *
 * Treasury = a classic SPL Token account for the payment mint, created with
 * `createAccountWithSeed(base = creator)` and OWNED BY THE CREATOR. The agent's signer
 * key is only a *delegate* with a capped allowance (`delegated_amount`), which the
 * SPL Token program enforces on-chain.
 */
import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  createApproveCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeAccount3Instruction,
  createRevokeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { USDC_DECIMALS } from "../shared/config";

/** Seed is ≤ 32 chars: "ryv" + first 29 hex chars of the agent UUID. */
export function treasurySeed(agentId: string): string {
  return ("ryv" + agentId.replace(/-/g, "")).slice(0, 32);
}

export function deriveTreasuryAddress(owner: PublicKey, agentId: string): PublicKey {
  // Same derivation as PublicKey.createWithSeed (sha256(base || seed || programId)), but synchronous.
  return createWithSeedSync(owner, treasurySeed(agentId), TOKEN_PROGRAM_ID);
}

export function createWithSeedSync(base: PublicKey, seed: string, programId: PublicKey): PublicKey {
  const buf = new Uint8Array([...base.toBytes(), ...new TextEncoder().encode(seed), ...programId.toBytes()]);
  return new PublicKey(sha256(buf));
}

export type FundTreasuryParams = {
  owner: PublicKey;
  agentId: string;
  agentSigner: PublicKey;
  mint: PublicKey;
  /** Create the treasury account in this transaction (first funding). */
  createAccount: boolean;
  rentLamports: number;
  /** Deposit from the owner's associated token account (base units). 0n = no deposit. */
  depositAmount: bigint;
  /** If set, (re)sets the agent's on-chain allowance to exactly this amount. */
  allowance: bigint | null;
};

export function buildFundTreasuryInstructions(p: FundTreasuryParams): TransactionInstruction[] {
  const seed = treasurySeed(p.agentId);
  const treasury = deriveTreasuryAddress(p.owner, p.agentId);
  const ixs: TransactionInstruction[] = [];
  if (p.createAccount) {
    ixs.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: p.owner,
        basePubkey: p.owner,
        seed,
        newAccountPubkey: treasury,
        lamports: p.rentLamports,
        space: ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(treasury, p.mint, p.owner, TOKEN_PROGRAM_ID),
    );
  }
  if (p.depositAmount > 0n) {
    const ownerAta = getAssociatedTokenAddressSync(p.mint, p.owner, false, TOKEN_PROGRAM_ID);
    ixs.push(
      createTransferCheckedInstruction(ownerAta, p.mint, treasury, p.owner, p.depositAmount, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
    );
  }
  if (p.allowance !== null) {
    ixs.push(
      createApproveCheckedInstruction(treasury, p.mint, p.agentSigner, p.owner, p.allowance, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
    );
  }
  return ixs;
}

/** On-chain kill switch: removes the agent's delegate authority entirely. */
export function buildRevokeInstructions(owner: PublicKey, agentId: string): TransactionInstruction[] {
  return [createRevokeInstruction(deriveTreasuryAddress(owner, agentId), owner, [], TOKEN_PROGRAM_ID)];
}

/** Owner withdraws funds from the treasury back to their own wallet. */
export function buildWithdrawInstructions(owner: PublicKey, agentId: string, mint: PublicKey, amount: bigint) {
  const ownerAta = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, ownerAta, owner, mint, TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(
      deriveTreasuryAddress(owner, agentId),
      mint,
      ownerAta,
      owner,
      amount,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];
}

/** Anyone (community, sponsors) can deposit into a treasury. */
export function buildDepositInstructions(from: PublicKey, treasury: PublicKey, mint: PublicKey, amount: bigint) {
  const fromAta = getAssociatedTokenAddressSync(mint, from, false, TOKEN_PROGRAM_ID);
  return [createTransferCheckedInstruction(fromAta, mint, treasury, from, amount, USDC_DECIMALS, [], TOKEN_PROGRAM_ID)];
}
