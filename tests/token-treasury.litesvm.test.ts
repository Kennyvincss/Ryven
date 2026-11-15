/** Same delegated-treasury guarantees for the agent's OWN token (Token-2022), as used for token rewards. */
import { describe, expect, it } from "vitest";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { buildFundTreasuryInstructions, deriveTreasuryAddress } from "../src/lib/solana/treasury";
import { buildAgentPaymentTransaction } from "../src/lib/solana/payment";

const T = (n: number) => BigInt(n) * 1_000_000n;
const dec = getTransactionDecoder();
const send = (svm: LiteSVM, tx: Transaction) => svm.sendTransaction(dec.decode(tx.serialize()));
function ok(r: ReturnType<LiteSVM["sendTransaction"]>) {
  if (r instanceof FailedTransactionMetadata) throw new Error(`tx failed: ${r.err()} ${r.meta().logs().join("\n")}`);
}
const acct = (svm: LiteSVM, pk: PublicKey) => {
  const a = svm.getAccount(address(pk.toBase58()));
  return a.exists ? AccountLayout.decode(Buffer.from(a.data).subarray(0, ACCOUNT_SIZE)) : null;
};

describe("token-rewards treasury on Token-2022 (LiteSVM)", () => {
  const svm = new LiteSVM().withDefaultPrograms();
  const creator = Keypair.generate();
  const feePayer = Keypair.generate();
  const agentSigner = Keypair.generate();
  const mintKp = Keypair.generate();
  const agentId = "7d1c6e2a-1111-4c6e-8f00-abcdefabcdef";
  const P = TOKEN_2022_PROGRAM_ID;
  const treasury = deriveTreasuryAddress(creator.publicKey, agentId, "token", P);
  const alice = Keypair.generate();
  svm.airdrop(address(creator.publicKey.toBase58()), lamports(10_000_000_000n));
  svm.airdrop(address(feePayer.publicKey.toBase58()), lamports(10_000_000_000n));
  const build = (payer: Keypair, ixs: TransactionInstruction[], signers: Keypair[] = []) => {
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() }).add(...ixs);
    tx.sign(payer, ...signers);
    return tx;
  };

  it("token treasury address differs from the USDC treasury", () => {
    expect(treasury.equals(deriveTreasuryAddress(creator.publicKey, agentId))).toBe(false);
  });

  it("creator mints 1,000,000 tokens, funds the token treasury and delegates 10,000", () => {
    const ata = getAssociatedTokenAddressSync(mintKp.publicKey, creator.publicKey, false, P);
    ok(
      send(
        svm,
        build(
          creator,
          [
            SystemProgram.createAccount({ fromPubkey: creator.publicKey, newAccountPubkey: mintKp.publicKey, lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))), space: MINT_SIZE, programId: P }),
            createInitializeMint2Instruction(mintKp.publicKey, 6, creator.publicKey, null, P),
            createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, ata, creator.publicKey, mintKp.publicKey, P),
            createMintToInstruction(mintKp.publicKey, ata, creator.publicKey, T(1_000_000), [], P),
          ],
          [mintKp],
        ),
      ),
    );
    ok(
      send(
        svm,
        build(
          creator,
          buildFundTreasuryInstructions({
            owner: creator.publicKey,
            agentId,
            agentSigner: agentSigner.publicKey,
            mint: mintKp.publicKey,
            createAccount: true,
            rentLamports: Number(svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),
            depositAmount: T(50_000),
            allowance: T(10_000),
            asset: "token",
            programId: P,
            decimals: 6,
          }),
        ),
      ),
    );
    const t = acct(svm, treasury)!;
    expect(t.owner.toBase58()).toBe(creator.publicKey.toBase58());
    expect(t.amount).toBe(T(50_000));
    expect(t.delegatedAmount).toBe(T(10_000));
  });

  const pay = (amount: bigint) => {
    const tx = buildAgentPaymentTransaction({
      paymentId: "t",
      feePayer: feePayer.publicKey,
      agentSigner: agentSigner.publicKey,
      treasury,
      mint: mintKp.publicKey,
      recipient: alice.publicKey,
      amount,
      recentBlockhash: svm.latestBlockhash(),
      programId: P,
      decimals: 6,
      includeMemo: false,
    });
    tx.sign(feePayer, agentSigner);
    return send(svm, tx);
  };

  it("agent pays a contributor 1,000 tokens as delegate", () => {
    ok(pay(T(1_000)));
    expect(acct(svm, getAssociatedTokenAddressSync(mintKp.publicKey, alice.publicKey, false, P))?.amount).toBe(T(1_000));
    expect(acct(svm, treasury)!.delegatedAmount).toBe(T(9_000));
  });

  it("Solana refuses token payments beyond the remaining allowance", () => {
    expect(pay(T(9_001))).toBeInstanceOf(FailedTransactionMetadata);
  });
});
