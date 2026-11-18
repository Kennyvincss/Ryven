/**
 * Delegated-treasury transaction builders (isomorphic: used by the browser to build
 * creator-signed transactions, and by the server/tests to verify them).
 *
 * A treasury is a token account created with `createAccountWithSeed(base = creator)` and
 * OWNED BY THE CREATOR. The agent's signer key is only a *delegate* with a capped
 * allowance (`delegated_amount`), which the token program enforces on-chain.
 *
 * Each agent can have two treasuries:
 *   - "usdc":  classic SPL Token account for the payment mint (USDC)
 *   - "token": account for the agent's own launched token (Token-2022), for token rewards
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

export type TreasuryAsset = "usdc" | "token" | "sol";

/** Describes which token a treasury holds. Defaults describe the USDC treasury. */
export type TreasuryToken = {
  asset: TreasuryAsset;
  mint: PublicKey;
  programId: PublicKey;
  decimals: number;
};

/** Seed is ≤ 32 chars: "ryv" (USDC) / "ryt" (own token) / "rys" (SOL) + first 29 hex chars of the agent UUID. */
export function treasurySeed(agentId: string, asset: TreasuryAsset = "usdc"): string {
  const prefix = asset === "usdc" ? "ryv" : asset === "token" ? "ryt" : "rys";
  return (prefix + agentId.replace(/-/g, "")).slice(0, 32);
}

export function deriveTreasuryAddress(owner: PublicKey, agentId: string, asset: TreasuryAsset = "usdc", programId: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
  // Same derivation as PublicKey.createWithSeed (sha256(base || seed || programId)), but synchronous.
  return createWithSeedSync(owner, treasurySeed(agentId, asset), programId);
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
  /** Token treasury options (defaults = USDC treasury on classic SPL Token). */
  asset?: TreasuryAsset;
  programId?: PublicKey;
  decimals?: number;
  accountSize?: number;
};

export function buildFundTreasuryInstructions(p: FundTreasuryParams): TransactionInstruction[] {
  const asset = p.asset ?? "usdc";
  const programId = p.programId ?? TOKEN_PROGRAM_ID;
  const decimals = p.decimals ?? USDC_DECIMALS;
  const seed = treasurySeed(p.agentId, asset);
  const treasury = deriveTreasuryAddress(p.owner, p.agentId, asset, programId);
  const ixs: TransactionInstruction[] = [];
  if (p.createAccount) {
    ixs.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: p.owner,
        basePubkey: p.owner,
        seed,
        newAccountPubkey: treasury,
        lamports: p.rentLamports,
        space: p.accountSize ?? ACCOUNT_SIZE,
        programId,
      }),
      createInitializeAccount3Instruction(treasury, p.mint, p.owner, programId),
    );
  }
  if (p.depositAmount > 0n) {
    const ownerAta = getAssociatedTokenAddressSync(p.mint, p.owner, false, programId);
    ixs.push(createTransferCheckedInstruction(ownerAta, p.mint, treasury, p.owner, p.depositAmount, decimals, [], programId));
  }
  if (p.allowance !== null) {
    ixs.push(createApproveCheckedInstruction(treasury, p.mint, p.agentSigner, p.owner, p.allowance, decimals, [], programId));
  }
  return ixs;
}

/** On-chain kill switch: removes the agent's delegate authority entirely. */
export function buildRevokeInstructions(owner: PublicKey, agentId: string, asset: TreasuryAsset = "usdc", programId: PublicKey = TOKEN_PROGRAM_ID): TransactionInstruction[] {
  return [createRevokeInstruction(deriveTreasuryAddress(owner, agentId, asset, programId), owner, [], programId)];
}

/** Owner withdraws funds from the treasury back to their own wallet. */
export function buildWithdrawInstructions(
  owner: PublicKey,
  agentId: string,
  mint: PublicKey,
  amount: bigint,
  asset: TreasuryAsset = "usdc",
  programId: PublicKey = TOKEN_PROGRAM_ID,
  decimals: number = USDC_DECIMALS,
) {
  const ownerAta = getAssociatedTokenAddressSync(mint, owner, false, programId);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, ownerAta, owner, mint, programId),
    createTransferCheckedInstruction(deriveTreasuryAddress(owner, agentId, asset, programId), mint, ownerAta, owner, amount, decimals, [], programId),
  ];
}

/** Anyone (community, sponsors) can deposit into a treasury. */
export function buildDepositInstructions(
  from: PublicKey,
  treasury: PublicKey,
  mint: PublicKey,
  amount: bigint,
  programId: PublicKey = TOKEN_PROGRAM_ID,
  decimals: number = USDC_DECIMALS,
) {
  const fromAta = getAssociatedTokenAddressSync(mint, from, false, programId);
  return [createTransferCheckedInstruction(fromAta, mint, treasury, from, amount, decimals, [], programId)];
}
