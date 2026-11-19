/**
 * Runs the exact transactions Ryven builds against the real SPL Token program inside
 * LiteSVM (an in-process Solana runtime). Proves the on-chain guarantees of the
 * delegated treasury: capped allowance, revocation kill switch, creator custody.
 */
import { describe, expect, it } from "vitest";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  buildCloseTreasuryInstructions,
  buildFundTreasuryInstructions,
  buildRevokeInstructions,
  buildWithdrawInstructions,
  deriveTreasuryAddress,
} from "../src/lib/solana/treasury";
import { buildAgentPaymentTransaction } from "../src/lib/solana/payment";

const U = (n: number) => BigInt(Math.round(n * 1e6));
const decoder = getTransactionDecoder();

function send(svm: LiteSVM, tx: Transaction) {
  const decoded = decoder.decode(tx.serialize());
  return svm.sendTransaction(decoded);
}
function build(svm: LiteSVM, payer: Keypair, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() }).add(...ixs);
  tx.sign(payer, ...signers);
  return tx;
}
function tokenAccount(svm: LiteSVM, pk: PublicKey) {
  const acc = svm.getAccount(address(pk.toBase58()));
  if (!acc.exists) return null;
  return AccountLayout.decode(Buffer.from(acc.data).subarray(0, ACCOUNT_SIZE));
}
function ok(r: ReturnType<LiteSVM["sendTransaction"]>) {
  if (r instanceof FailedTransactionMetadata) throw new Error(`tx failed: ${r.err()} ${r.meta().logs().join("\n")}`);
}

describe("delegated treasury on SPL Token (LiteSVM)", () => {
  // Note: LiteSVM's default feature set cannot execute the legacy-loader SPL Memo program,
  // so these tests omit the memo instruction. The full transaction (with memo) is exercised
  // against devnet by scripts/e2e-devnet.ts.
  const svm = new LiteSVM().withDefaultPrograms();
  const creator = Keypair.generate();
  const feePayer = Keypair.generate();
  const agentSigner = Keypair.generate();
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const agentId = "2b6f0c3e-9a1d-4c6e-8f00-123456789abc";
  const treasury = deriveTreasuryAddress(creator.publicKey, agentId);
  const recipients = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];

  svm.airdrop(address(creator.publicKey.toBase58()), lamports(10_000_000_000n));
  svm.airdrop(address(feePayer.publicKey.toBase58()), lamports(10_000_000_000n));

  it("sets up a USDC-like mint and funds the creator with 100", () => {
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
    ok(
      send(
        svm,
        build(
          svm,
          creator,
          [
            SystemProgram.createAccount({
              fromPubkey: creator.publicKey,
              newAccountPubkey: mint,
              lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
              space: MINT_SIZE,
              programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(mint, 6, creator.publicKey, null),
            createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, creatorAta, creator.publicKey, mint),
            createMintToInstruction(mint, creatorAta, creator.publicKey, U(100)),
          ],
          [mintKp],
        ),
      ),
    );
    expect(tokenAccount(svm, creatorAta)?.amount).toBe(U(100));
  });

  it("creator creates the treasury, deposits 100 and delegates a 20 USDC allowance in one tx", () => {
    const ixs = buildFundTreasuryInstructions({
      owner: creator.publicKey,
      agentId,
      agentSigner: agentSigner.publicKey,
      mint,
      createAccount: true,
      rentLamports: Number(svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),
      depositAmount: U(100),
      allowance: U(20),
    });
    ok(send(svm, build(svm, creator, ixs)));
    const t = tokenAccount(svm, treasury)!;
    expect(t.owner.toBase58()).toBe(creator.publicKey.toBase58()); // creator keeps custody
    expect(t.amount).toBe(U(100));
    expect(t.delegate.toBase58()).toBe(agentSigner.publicKey.toBase58());
    expect(t.delegatedAmount).toBe(U(20));
  });

  const pay = (recipient: PublicKey, amount: bigint, id: string) => {
    const tx = buildAgentPaymentTransaction({
      paymentId: id,
      feePayer: feePayer.publicKey,
      agentSigner: agentSigner.publicKey,
      treasury,
      mint,
      recipient,
      amount,
      recentBlockhash: svm.latestBlockhash(),
      includeMemo: false,
    });
    tx.sign(feePayer, agentSigner);
    return send(svm, tx);
  };

  it("agent pays three contributors 5 USDC each as delegate (demo scenario)", () => {
    for (let i = 0; i < 3; i++) ok(pay(recipients[i].publicKey, U(5), `p${i}`));
    for (let i = 0; i < 3; i++) {
      expect(tokenAccount(svm, getAssociatedTokenAddressSync(mint, recipients[i].publicKey))?.amount).toBe(U(5));
    }
    const t = tokenAccount(svm, treasury)!;
    expect(t.amount).toBe(U(85));
    expect(t.delegatedAmount).toBe(U(5)); // 20 - 15 remaining allowance
  });

  it("Solana itself refuses a transfer beyond the remaining allowance, even if the server is compromised", () => {
    const r = pay(recipients[3].publicKey, U(6), "over");
    expect(r).toBeInstanceOf(FailedTransactionMetadata);
    expect(tokenAccount(svm, treasury)!.amount).toBe(U(85));
  });

  it("revoke (kill switch) removes the agent's authority on-chain", () => {
    ok(send(svm, build(svm, creator, buildRevokeInstructions(creator.publicKey, agentId))));
    const r = pay(recipients[3].publicKey, U(1), "after-revoke");
    expect(r).toBeInstanceOf(FailedTransactionMetadata);
    expect(tokenAccount(svm, treasury)!.delegateOption).toBe(0);
  });

  it("the agent key can never move funds from the creator's personal wallet", () => {
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
    // Top up creator's personal ATA, then try to make the agent spend from it.
    ok(send(svm, build(svm, creator, [createMintToInstruction(mint, creatorAta, creator.publicKey, U(10))])));
    const tx = buildAgentPaymentTransaction({
      paymentId: "steal",
      feePayer: feePayer.publicKey,
      agentSigner: agentSigner.publicKey,
      treasury: creatorAta,
      mint,
      recipient: recipients[3].publicKey,
      amount: U(1),
      recentBlockhash: svm.latestBlockhash(),
      includeMemo: false,
    });
    tx.sign(feePayer, agentSigner);
    expect(send(svm, tx)).toBeInstanceOf(FailedTransactionMetadata);
  });

  it("creator can withdraw at any time", () => {
    ok(send(svm, build(svm, creator, buildWithdrawInstructions(creator.publicKey, agentId, mint, U(80)))));
    expect(tokenAccount(svm, treasury)!.amount).toBe(U(5));
  });

  it("deleting the agent: creator gets the rest back and the treasury is closed", () => {
    const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
    const before = tokenAccount(svm, creatorAta)!.amount;
    ok(send(svm, build(svm, creator, buildCloseTreasuryInstructions(creator.publicKey, agentId, { asset: "usdc", mint, programId: TOKEN_PROGRAM_ID, decimals: 6, balance: U(5) }))));
    expect(tokenAccount(svm, creatorAta)!.amount - before).toBe(U(5));
    expect(tokenAccount(svm, treasury)).toBeNull();
  });
});
