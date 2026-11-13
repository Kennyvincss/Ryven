import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { evaluatePayment, type AgentPolicy, type PolicyContext } from "../src/lib/server/engine/policy";

const U = (n: number) => BigInt(Math.round(n * 1e6));
const signer = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();

const agent: AgentPolicy = {
  status: "active",
  mode: "autonomous",
  maxPerTx: U(5),
  autoApproveLimit: U(5),
  dailyLimit: U(20),
  categories: ["community_rewards"],
  recipientPolicy: "allowlist_only",
  signerPubkey: signer,
  treasuryAddress: treasury,
  creatorWallet: Keypair.generate().publicKey.toBase58(),
};
const ctx: PolicyContext = {
  globalPause: false,
  reservedToday: 0n,
  inFlight: 0n,
  onchain: { balance: U(100), allowance: U(100), delegate: signer },
  contributor: { status: "approved" },
  recentToRecipient: 0,
};
const prop = { recipient, amount: U(5), category: "community_rewards", reason: "Weekly community reward" };

describe("payment policy", () => {
  it("approves the demo payment (5 USDC, approved contributor, within limits)", () => {
    expect(evaluatePayment(agent, prop, ctx).decision).toBe("approve");
  });
  it("rejects above max per transaction", () => {
    const r = evaluatePayment({ ...agent, maxPerTx: U(5), autoApproveLimit: U(2) }, { ...prop, amount: U(10) }, ctx);
    expect(r.decision).toBe("reject");
    expect(r.checks.find((c) => c.id === "max_per_tx")?.passed).toBe(false);
  });
  it("requires approval above the autonomous limit but within max", () => {
    const r = evaluatePayment({ ...agent, maxPerTx: U(10), autoApproveLimit: U(5) }, { ...prop, amount: U(10) }, ctx);
    expect(r.decision).toBe("needs_approval");
  });
  it("creator approval skips only the approval gate, never hard limits", () => {
    const a = { ...agent, maxPerTx: U(10), autoApproveLimit: U(5) };
    expect(evaluatePayment(a, { ...prop, amount: U(10) }, ctx, { skipApprovalGate: true }).decision).toBe("approve");
    expect(evaluatePayment(a, { ...prop, amount: U(10) }, { ...ctx, reservedToday: U(15) }, { skipApprovalGate: true }).decision).toBe("reject");
  });
  it("enforces the daily limit cumulatively", () => {
    expect(evaluatePayment(agent, prop, { ...ctx, reservedToday: U(15) }).decision).toBe("approve");
    expect(evaluatePayment(agent, prop, { ...ctx, reservedToday: U(15.01) }).decision).toBe("reject");
  });
  it("rejects when the on-chain balance or allowance is insufficient (including in-flight)", () => {
    expect(evaluatePayment(agent, prop, { ...ctx, onchain: { balance: U(4), allowance: U(100), delegate: signer } }).decision).toBe("reject");
    expect(evaluatePayment(agent, prop, { ...ctx, onchain: { balance: U(100), allowance: U(4), delegate: signer } }).decision).toBe("reject");
    expect(evaluatePayment(agent, prop, { ...ctx, inFlight: U(96) }).decision).toBe("reject");
  });
  it("rejects when the creator revoked the delegate on-chain", () => {
    expect(evaluatePayment(agent, prop, { ...ctx, onchain: { balance: U(100), allowance: 0n, delegate: null } }).decision).toBe("reject");
  });
  it("rejects when chain state is unreadable", () => {
    expect(evaluatePayment(agent, prop, { ...ctx, onchain: null }).decision).toBe("reject");
  });
  it("rejects unlisted recipients in allowlist_only mode, asks approval otherwise", () => {
    expect(evaluatePayment(agent, prop, { ...ctx, contributor: null }).decision).toBe("reject");
    expect(evaluatePayment({ ...agent, recipientPolicy: "allowlist_or_approval" }, prop, { ...ctx, contributor: null }).decision).toBe("needs_approval");
    expect(evaluatePayment(agent, prop, { ...ctx, contributor: { status: "suspended" } }).decision).toBe("reject");
  });
  it("rejects disallowed categories, invalid addresses and self-payments", () => {
    expect(evaluatePayment(agent, { ...prop, category: "marketing" }, ctx).decision).toBe("reject");
    expect(evaluatePayment(agent, { ...prop, recipient: "not-a-wallet" }, ctx).decision).toBe("reject");
    expect(evaluatePayment(agent, { ...prop, recipient: treasury }, ctx).decision).toBe("reject");
    expect(evaluatePayment(agent, { ...prop, recipient: signer }, ctx).decision).toBe("reject");
  });
  it("halts on pause (agent or platform)", () => {
    expect(evaluatePayment({ ...agent, status: "paused" }, prop, ctx).decision).toBe("reject");
    expect(evaluatePayment(agent, prop, { ...ctx, globalPause: true }).decision).toBe("reject");
  });
  it("requires approval for duplicates and in approval mode", () => {
    expect(evaluatePayment(agent, prop, { ...ctx, recentToRecipient: 1 }).decision).toBe("needs_approval");
    expect(evaluatePayment({ ...agent, mode: "approval" }, prop, ctx).decision).toBe("needs_approval");
  });
  it("rejects zero amounts", () => {
    expect(evaluatePayment(agent, { ...prop, amount: 0n }, ctx).decision).toBe("reject");
  });
});
