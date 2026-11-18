import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { validateCreateTransaction } from "../src/lib/server/pumpfun";
import { NATIVE_MINT, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { JUPITER_PROGRAM, validateSwapTransaction } from "../src/lib/server/jupiter";
import { PUMP_PROGRAM_ID } from "../src/lib/shared/config";

const creator = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const pumpIx = (signers: PublicKey[]) =>
  new TransactionInstruction({
    programId: new PublicKey(PUMP_PROGRAM_ID),
    keys: signers.map((k) => ({ pubkey: k, isSigner: true, isWritable: true })),
    data: Buffer.from([1, 2, 3]),
  });
function build(payer: PublicKey, ixs: TransactionInstruction[]) {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: ixs }).compileToV0Message();
  return new VersionedTransaction(msg);
}

describe("pump.fun create transaction validation", () => {
  it("accepts a create signed by creator + mint calling only allowlisted programs", () => {
    const tx = build(creator, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), pumpIx([creator, mint])]);
    expect(() => validateCreateTransaction(tx, creator.toBase58(), mint.toBase58())).not.toThrow();
  });
  it("rejects a different fee payer", () => {
    const other = Keypair.generate().publicKey;
    const tx = build(other, [pumpIx([other, mint])]);
    expect(() => validateCreateTransaction(tx, creator.toBase58(), mint.toBase58())).toThrow(/2 signatures|Fee payer/);
  });
  it("rejects an extra signer", () => {
    const extra = Keypair.generate().publicKey;
    const tx = build(creator, [pumpIx([creator, mint, extra])]);
    expect(() => validateCreateTransaction(tx, creator.toBase58(), mint.toBase58())).toThrow(/exactly 2 signatures/);
  });
  it("rejects calls to unknown programs (e.g. a sneaky drain)", () => {
    const evil = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: creator, isSigner: true, isWritable: true }], data: Buffer.alloc(0) });
    const tx = build(creator, [pumpIx([creator, mint]), evil]);
    expect(() => validateCreateTransaction(tx, creator.toBase58(), mint.toBase58())).toThrow(/unexpected program/);
  });
  it("rejects a transaction that doesn't call pump.fun", () => {
    const tx = build(creator, [SystemProgram.transfer({ fromPubkey: creator, toPubkey: mint, lamports: 1 })]);
    expect(() => validateCreateTransaction(tx, creator.toBase58(), mint.toBase58())).toThrow(/2 signatures|pump.fun program/);
  });
});

describe("Jupiter swap transaction validation", () => {
  const wallet = Keypair.generate().publicKey;
  const jupIx = (signers: PublicKey[] = [wallet]) =>
    new TransactionInstruction({ programId: new PublicKey(JUPITER_PROGRAM), keys: signers.map((k) => ({ pubkey: k, isSigner: true, isWritable: true })), data: Buffer.from([9]) });
  it("accepts a single-signer swap through the Jupiter router", () => {
    const tx = build(wallet, [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), jupIx()]);
    expect(() => validateSwapTransaction(tx, wallet.toBase58())).not.toThrow();
  });
  it("rejects a different fee payer or an extra signer", () => {
    const other = Keypair.generate().publicKey;
    expect(() => validateSwapTransaction(build(other, [jupIx([other])]), wallet.toBase58())).toThrow(/fee payer/);
    expect(() => validateSwapTransaction(build(wallet, [jupIx([wallet, other])]), wallet.toBase58())).toThrow(/exactly one signature/);
  });
  it("rejects transactions without the router or with unknown programs", () => {
    const transfer = SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 1 });
    expect(() => validateSwapTransaction(build(wallet, [transfer]), wallet.toBase58())).toThrow(/Jupiter router/);
  });
  it("allows wrapping the wallet's own SOL but no transfer to anyone else", () => {
    const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, wallet);
    const wrap = [
      createAssociatedTokenAccountIdempotentInstruction(wallet, wsol, wallet, NATIVE_MINT),
      SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wsol, lamports: 10_000_000 }),
      createSyncNativeInstruction(wsol),
      jupIx(),
      createCloseAccountInstruction(wsol, wallet, wallet),
    ];
    expect(() => validateSwapTransaction(build(wallet, wrap), wallet.toBase58())).not.toThrow();
    const thief = Keypair.generate().publicKey;
    const steal = SystemProgram.transfer({ fromPubkey: wallet, toPubkey: thief, lamports: 1_000_000 });
    expect(() => validateSwapTransaction(build(wallet, [jupIx(), steal]), wallet.toBase58())).toThrow(/SOL transfer/);
    const tokenSteal = createTransferInstruction(wsol, getAssociatedTokenAddressSync(NATIVE_MINT, thief), wallet, 1);
    expect(() => validateSwapTransaction(build(wallet, [jupIx(), tokenSteal]), wallet.toBase58())).toThrow(/token instruction/);
    const closeToThief = createCloseAccountInstruction(wsol, thief, wallet);
    expect(() => validateSwapTransaction(build(wallet, [jupIx(), closeToThief]), wallet.toBase58())).toThrow(/token instruction/);
    const evil = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([]) });
    expect(() => validateSwapTransaction(build(wallet, [jupIx(), evil]), wallet.toBase58())).toThrow(/unexpected program/);
  });
});
