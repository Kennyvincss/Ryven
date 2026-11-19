/** SOL payments: wrapped-SOL treasury owned by the creator, agent as capped delegate, recipient gets plain SOL. */
import { describe, expect, it } from "vitest";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import { ACCOUNT_SIZE, AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { buildCloseTreasuryInstructions, deriveTreasuryAddress } from "../src/lib/solana/treasury";
import { NATIVE_MINT } from "@solana/spl-token";
import { buildAgentSolPaymentTransaction, buildFundSolTreasuryInstructions, buildWithdrawSolInstructions } from "../src/lib/solana/sol-payment";

const SOL = (n: number) => BigInt(Math.round(n * 1e9));
const dec = getTransactionDecoder();
const send = (svm: LiteSVM, tx: Transaction) => svm.sendTransaction(dec.decode(tx.serialize()));
const ok = (r: ReturnType<LiteSVM["sendTransaction"]>) => {
  if (r instanceof FailedTransactionMetadata) throw new Error(`tx failed: ${r.err()} ${r.meta().logs().join("\n")}`);
};

describe("SOL payments via wrapped-SOL treasury (LiteSVM)", () => {
  const svm = new LiteSVM().withDefaultPrograms().withNativeMints();
  const creator = Keypair.generate(), feePayer = Keypair.generate(), agent = Keypair.generate(), alice = Keypair.generate();
  const agentId = "5a5a5a5a-1111-4c6e-8f00-000000000001";
  const treasury = deriveTreasuryAddress(creator.publicKey, agentId, "sol", TOKEN_PROGRAM_ID);
  const rent = Number(svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE)));
  svm.airdrop(address(creator.publicKey.toBase58()), lamports(5_000_000_000n));
  svm.airdrop(address(feePayer.publicKey.toBase58()), lamports(1_000_000_000n));
  const bal = (pk: PublicKey) => svm.getBalance(address(pk.toBase58())) ?? 0n;
  const wrapped = () => {
    const a = svm.getAccount(address(treasury.toBase58()));
    return a.exists ? AccountLayout.decode(Buffer.from(a.data).subarray(0, ACCOUNT_SIZE)) : null;
  };
  const build = (payer: Keypair, ixs: TransactionInstruction[], extra: Keypair[] = []) => {
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() }).add(...ixs);
    tx.sign(payer, ...extra);
    return tx;
  };
  const pay = (amount: bigint, to: PublicKey = alice.publicKey) => {
    const temp = Keypair.generate();
    const tx = buildAgentSolPaymentTransaction({
      paymentId: "p", feePayer: feePayer.publicKey, agentSigner: agent.publicKey, treasury, recipient: to,
      lamports: amount, temp: temp.publicKey, tempRentLamports: rent, recentBlockhash: svm.latestBlockhash(), includeMemo: false,
    });
    tx.sign(feePayer, agent, temp);
    return send(svm, tx);
  };

  it("creator wraps 1 SOL into a treasury they own and delegates 0.3 SOL", () => {
    ok(send(svm, build(creator, buildFundSolTreasuryInstructions({ owner: creator.publicKey, agentId, agentSigner: agent.publicKey, createAccount: true, rentLamports: rent, depositLamports: SOL(1), allowance: SOL(0.3) }))));
    const t = wrapped()!;
    expect(t.owner.toBase58()).toBe(creator.publicKey.toBase58());
    expect(t.amount).toBe(SOL(1));
    expect(t.delegatedAmount).toBe(SOL(0.3));
  });

  it("agent pays 0.1 SOL: recipient receives PLAIN SOL, fee payer breaks even (minus network fee)", () => {
    const feeBefore = bal(feePayer.publicKey);
    ok(pay(SOL(0.1)));
    expect(bal(alice.publicKey)).toBe(SOL(0.1));
    expect(wrapped()!.amount).toBe(SOL(0.9));
    expect(wrapped()!.delegatedAmount).toBe(SOL(0.2));
    const spent = feeBefore - bal(feePayer.publicKey);
    expect(spent >= 0n && spent <= 20_000n).toBe(true); // only signature fees
  });

  it("top-up deposit (transfer + sync) increases the wrapped balance", () => {
    ok(send(svm, build(creator, buildFundSolTreasuryInstructions({ owner: creator.publicKey, agentId, agentSigner: agent.publicKey, createAccount: false, rentLamports: rent, depositLamports: SOL(0.5), allowance: null }))));
    expect(wrapped()!.amount).toBe(SOL(1.4));
  });

  it("Solana refuses a payment above the remaining allowance", () => {
    expect(pay(SOL(0.25))).toBeInstanceOf(FailedTransactionMetadata);
    expect(bal(alice.publicKey)).toBe(SOL(0.1));
  });

  it("creator withdraws 0.4 SOL back as plain SOL", () => {
    const before = bal(creator.publicKey);
    const temp = Keypair.generate();
    ok(send(svm, build(creator, buildWithdrawSolInstructions(creator.publicKey, agentId, SOL(0.4), temp.publicKey, rent), [temp])));
    expect(wrapped()!.amount).toBe(SOL(1.0));
    expect(bal(creator.publicKey) - before > SOL(0.39)).toBe(true);
  });

  it("deleting the agent: closing the treasury returns all SOL plus rent, and the agent can no longer pay", () => {
    const before = bal(creator.publicKey);
    ok(send(svm, build(creator, buildCloseTreasuryInstructions(creator.publicKey, agentId, { asset: "sol", mint: NATIVE_MINT, programId: TOKEN_PROGRAM_ID, decimals: 9, balance: SOL(1) }))));
    expect(wrapped()).toBeNull();
    const back = bal(creator.publicKey) - before;
    expect(back > SOL(1) && back <= SOL(1) + BigInt(rent)).toBe(true);
    expect(pay(SOL(0.01))).toBeInstanceOf(FailedTransactionMetadata);
  });
});
