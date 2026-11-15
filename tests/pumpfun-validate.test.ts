import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { validateCreateTransaction } from "../src/lib/server/pumpfun";
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
