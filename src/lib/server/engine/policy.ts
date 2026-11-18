/**
 * Deterministic payment policy. Pure function: no I/O, no LLM, fully unit-tested.
 * Every payment, whether proposed by the AI agent or by the creator, passes through here.
 */
import { PublicKey } from "@solana/web3.js";
import { fromBaseUnits } from "../../shared/amounts";
import type { PolicyCheck, PolicyRecord } from "../db/schema";

export type AgentPolicy = {
  status: "active" | "paused";
  mode: "autonomous" | "approval";
  maxPerTx: bigint;
  autoApproveLimit: bigint;
  dailyLimit: bigint;
  categories: string[];
  recipientPolicy: "allowlist_only" | "allowlist_or_approval";
  signerPubkey: string;
  treasuryAddress: string;
  creatorWallet: string;
  /** Asset the limits are denominated in (USDC by default). */
  unit?: { symbol: string; decimals: number };
  /** Smallest allowed payment (e.g. SOL: a new wallet must receive its rent minimum). */
  minAmount?: bigint;
};

export type PolicyContext = {
  globalPause: boolean;
  /** Approved + executing + confirmed payments reserved since 00:00 UTC (base units). */
  reservedToday: bigint;
  /** Approved + executing payments not yet settled (still consume balance/allowance). */
  inFlight: bigint;
  /** Live on-chain state of the treasury token account. null = could not be read. */
  onchain: { balance: bigint; allowance: bigint; delegate: string | null } | null;
  contributor: { status: "approved" | "suspended" } | null;
  /** Number of payments to this recipient in the last 24h (approved/executing/confirmed). */
  recentToRecipient: number;
};

export type PaymentProposal = {
  recipient: string;
  amount: bigint;
  category: string;
  reason: string;
};

/** `skipApprovalGate` is set only when the creator has explicitly approved this payment. */
export function evaluatePayment(
  agent: AgentPolicy,
  proposal: PaymentProposal,
  ctx: PolicyContext,
  opts: { skipApprovalGate?: boolean } = {},
): PolicyRecord {
  const checks: PolicyCheck[] = [];
  const unit = agent.unit ?? { symbol: "USDC", decimals: 6 };
  const usd = (v: bigint) => `${fromBaseUnits(v, unit.decimals)} ${unit.symbol}`;
  const add = (c: PolicyCheck) => checks.push(c);

  add({
    id: "global_pause",
    label: "Platform payments enabled",
    passed: !ctx.globalPause,
    detail: ctx.globalPause ? "Payments are paused platform-wide by an administrator" : "Platform kill switch is off",
    effect: "reject",
  });
  add({
    id: "agent_active",
    label: "Agent active",
    passed: agent.status === "active",
    detail: agent.status === "active" ? "Agent is active" : "Agent is paused",
    effect: "reject",
  });
  add({
    id: "asset_enabled",
    label: `${unit.symbol} payments enabled`,
    passed: agent.dailyLimit > 0n && agent.maxPerTx > 0n,
    detail: agent.dailyLimit > 0n && agent.maxPerTx > 0n ? `Creator allows ${unit.symbol} payments` : `The creator has not enabled payments in ${unit.symbol}`,
    effect: "reject",
  });
  add({
    id: "amount_valid",
    label: "Valid amount",
    passed: proposal.amount > 0n,
    detail: proposal.amount > 0n ? usd(proposal.amount) : "Amount must be greater than zero",
    effect: "reject",
  });
  if (agent.minAmount !== undefined) {
    add({
      id: "min_amount",
      label: "Above minimum",
      passed: proposal.amount >= agent.minAmount,
      detail: proposal.amount >= agent.minAmount ? `At least ${usd(agent.minAmount)}` : `Minimum payment is ${usd(agent.minAmount)}`,
      effect: "reject",
    });
  }
  add({
    id: "category",
    label: "Approved category",
    passed: agent.categories.includes(proposal.category),
    detail: agent.categories.includes(proposal.category)
      ? `"${proposal.category}" is permitted`
      : `"${proposal.category}" is not an approved category (${agent.categories.join(", ") || "none"})`,
    effect: "reject",
  });
  add({
    id: "reason",
    label: "Payment reason recorded",
    passed: proposal.reason.trim().length >= 3,
    detail: proposal.reason.trim().length >= 3 ? "Reason provided" : "Every payment needs a reason",
    effect: "reject",
  });

  let validRecipient = false;
  try {
    const pk = new PublicKey(proposal.recipient);
    validRecipient =
      PublicKey.isOnCurve(pk.toBytes()) &&
      proposal.recipient !== agent.treasuryAddress &&
      proposal.recipient !== agent.signerPubkey;
  } catch {
    validRecipient = false;
  }
  add({
    id: "recipient_valid",
    label: "Valid recipient wallet",
    passed: validRecipient,
    detail: validRecipient ? "Recipient is a valid wallet" : "Recipient is not a valid wallet address (or is the agent itself)",
    effect: "reject",
  });

  const listed = ctx.contributor?.status === "approved";
  if (listed) {
    add({ id: "recipient_allowlist", label: "Recipient approved", passed: true, detail: "Recipient is an approved contributor" });
  } else if (agent.recipientPolicy === "allowlist_only") {
    add({
      id: "recipient_allowlist",
      label: "Recipient approved",
      passed: false,
      detail: ctx.contributor ? "Contributor is suspended" : "Recipient is not on the approved contributor list",
      effect: "reject",
    });
  } else {
    add({
      id: "recipient_allowlist",
      label: "Recipient approved",
      passed: false,
      detail: "Recipient is not on the approved list; creator approval required",
      effect: "approval",
    });
  }

  add({
    id: "max_per_tx",
    label: "Within max per transaction",
    passed: proposal.amount <= agent.maxPerTx,
    detail: `${usd(proposal.amount)} vs max ${usd(agent.maxPerTx)}`,
    effect: "reject",
  });

  const afterToday = ctx.reservedToday + proposal.amount;
  add({
    id: "daily_limit",
    label: "Within daily limit",
    passed: afterToday <= agent.dailyLimit,
    detail: `${usd(ctx.reservedToday)} used today + ${usd(proposal.amount)} vs limit ${usd(agent.dailyLimit)}`,
    effect: "reject",
  });

  if (ctx.onchain === null) {
    add({
      id: "onchain_state",
      label: "Treasury readable on-chain",
      passed: false,
      detail: "Could not read the treasury account from Solana",
      effect: "reject",
    });
  } else {
    const need = ctx.inFlight + proposal.amount;
    add({
      id: "delegate",
      label: "Agent holds on-chain allowance",
      passed: ctx.onchain.delegate === agent.signerPubkey,
      detail:
        ctx.onchain.delegate === agent.signerPubkey
          ? "Treasury delegate is this agent"
          : "Creator has not delegated (or has revoked) spending authority",
      effect: "reject",
    });
    add({
      id: "balance",
      label: "Sufficient treasury balance",
      passed: ctx.onchain.balance >= need,
      detail: `${usd(ctx.onchain.balance)} on-chain, ${usd(need)} needed incl. in-flight`,
      effect: "reject",
    });
    add({
      id: "allowance",
      label: "Sufficient on-chain allowance",
      passed: ctx.onchain.allowance >= need,
      detail: `${usd(ctx.onchain.allowance)} allowance, ${usd(need)} needed incl. in-flight`,
      effect: "reject",
    });
  }

  if (!opts.skipApprovalGate) {
    add({
      id: "duplicate",
      label: "No recent duplicate",
      passed: ctx.recentToRecipient === 0,
      detail:
        ctx.recentToRecipient === 0
          ? "No payment to this recipient in the last 24h"
          : `${ctx.recentToRecipient} payment(s) to this recipient in the last 24h; approval required`,
      effect: "approval",
    });
    const autonomous = agent.mode === "autonomous";
    add({
      id: "autonomy",
      label: "Within autonomous limit",
      passed: autonomous && proposal.amount <= agent.autoApproveLimit,
      detail: !autonomous
        ? "Agent is in approval mode: every payment needs creator approval"
        : proposal.amount <= agent.autoApproveLimit
          ? `${usd(proposal.amount)} ≤ autonomous limit ${usd(agent.autoApproveLimit)}`
          : `${usd(proposal.amount)} exceeds autonomous limit ${usd(agent.autoApproveLimit)}; approval required`,
      effect: "approval",
    });
  } else {
    add({ id: "creator_approval", label: "Creator approval", passed: true, detail: "Approved by creator" });
  }

  const failedReject = checks.filter((c) => !c.passed && c.effect === "reject");
  const failedApproval = checks.filter((c) => !c.passed && c.effect === "approval");
  if (failedReject.length) {
    return { decision: "reject", summary: failedReject.map((c) => c.detail).join("; "), checks };
  }
  if (failedApproval.length) {
    return { decision: "needs_approval", summary: failedApproval.map((c) => c.detail).join("; "), checks };
  }
  return { decision: "approve", summary: "All policy checks passed", checks };
}
