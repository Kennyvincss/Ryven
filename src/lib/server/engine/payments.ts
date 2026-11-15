import "server-only";
/**
 * Payment engine: proposal → policy → reservation → (approval) → execution → verification.
 * The LLM never calls anything below `proposePayments`; it cannot approve, sign or
 * change limits. All financial rules are enforced here and on-chain.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { PublicKey, SendTransactionError } from "@solana/web3.js";
import { deriveTreasuryAddress, treasurySeed, type TreasuryAsset } from "../../solana/treasury";
import { BlockhashExpiredError, confirmByPolling } from "../../solana/confirm";
import { db, schema, type Tx } from "../db";
import { connection, readTreasuryState, getConfirmedTransaction, tokenDeltaForOwner, tokenDeltaForAccount, type TreasuryState } from "../solana";
import { signAgentPayment } from "../signer";
import { evaluatePayment, type AgentPolicy, type PaymentProposal } from "./policy";
import { logActivity } from "./activity";
import { fromBaseUnits } from "../../shared/amounts";

type Agent = typeof schema.agents.$inferSelect;
type Treasury = typeof schema.treasuries.$inferSelect;
export type Payment = typeof schema.payments.$inferSelect;

const RESERVED: Payment["status"][] = ["approved", "executing", "confirmed"];
const IN_FLIGHT: Payment["status"][] = ["approved", "executing"];

export class EngineError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function isPlatformPaused(): Promise<boolean> {
  const row = await db.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, "payments_paused") });
  return row?.value === true;
}

export async function loadAgent(agentId: string, asset: TreasuryAsset = "usdc"): Promise<{ agent: Agent; treasury: Treasury }> {
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
  if (!agent) throw new EngineError("Agent not found", 404);
  const treasury =
    asset === "token"
      ? await ensureTokenTreasury(agent)
      : await db.query.treasuries.findFirst({ where: and(eq(schema.treasuries.agentId, agentId), eq(schema.treasuries.asset, "usdc")) });
  if (!treasury) throw new EngineError("Agent has no treasury", 409);
  return { agent, treasury };
}

/**
 * The agent's second treasury, holding its OWN launched token (for token rewards).
 * Created lazily: a creator-owned Token-2022 account derived from the creator's wallet.
 */
export async function ensureTokenTreasury(agent: Agent): Promise<Treasury> {
  const existing = await db.query.treasuries.findFirst({ where: and(eq(schema.treasuries.agentId, agent.id), eq(schema.treasuries.asset, "token")) });
  if (existing) return existing;
  const token = await db.query.tokens.findFirst({ where: eq(schema.tokens.id, agent.tokenId) });
  if (!token) throw new EngineError("Agent token not found", 404);
  if (token.network !== "devnet") throw new EngineError("Token rewards are only available for devnet tokens", 409);
  const programId = new PublicKey(token.tokenProgram);
  const address = deriveTreasuryAddress(new PublicKey(agent.creatorWallet), agent.id, "token", programId).toBase58();
  await db
    .insert(schema.treasuries)
    .values({
      agentId: agent.id,
      asset: "token",
      address,
      seed: treasurySeed(agent.id, "token"),
      ownerWallet: agent.creatorWallet,
      mint: token.mint,
      tokenProgram: token.tokenProgram,
      decimals: token.decimals,
      symbol: token.symbol,
    })
    .onConflictDoNothing();
  const row = await db.query.treasuries.findFirst({ where: and(eq(schema.treasuries.agentId, agent.id), eq(schema.treasuries.asset, "token")) });
  if (!row) throw new EngineError("Could not create token treasury", 500);
  return row;
}

export const assetLabel = (t: Pick<Treasury, "asset" | "symbol">) => (t.asset === "usdc" ? "USDC" : `$${t.symbol}`);
export const fmtAmount = (amount: bigint, t: Pick<Treasury, "asset" | "symbol" | "decimals">) => `${fromBaseUnits(amount, t.decimals)} ${assetLabel(t)}`;

export function toPolicy(agent: Agent, treasury: Treasury): AgentPolicy {
  const isToken = treasury.asset === "token";
  return {
    status: agent.status,
    mode: agent.mode,
    maxPerTx: isToken ? (agent.tokenMaxPerTx ?? 0n) : agent.maxPerTx,
    autoApproveLimit: isToken ? (agent.tokenAutoApproveLimit ?? 0n) : agent.autoApproveLimit,
    dailyLimit: isToken ? (agent.tokenDailyLimit ?? 0n) : agent.dailyLimit,
    unit: { symbol: assetLabel(treasury), decimals: treasury.decimals },
    categories: agent.categories,
    recipientPolicy: agent.recipientPolicy,
    signerPubkey: agent.signerPubkey,
    treasuryAddress: treasury.address,
    creatorWallet: agent.creatorWallet,
  };
}

async function sumAmounts(tx: Tx | typeof db, agentId: string, asset: TreasuryAsset, statuses: Payment["status"][], since?: Date) {
  const conds = [eq(schema.payments.agentId, agentId), eq(schema.payments.asset, asset), inArray(schema.payments.status, statuses)];
  if (since) conds.push(gte(schema.payments.reservedAt, since));
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${schema.payments.amount}), 0)::text` })
    .from(schema.payments)
    .where(and(...conds));
  return BigInt(row.total);
}

/** Refreshes the display cache from chain and returns the authoritative state. */
export async function syncTreasury(treasury: Treasury): Promise<TreasuryState> {
  const state = await readTreasuryState(treasury.address);
  if (state.exists && (state.owner !== treasury.ownerWallet || state.mint !== treasury.mint)) {
    throw new EngineError("Treasury account owner/mint does not match the agent record", 409);
  }
  await db
    .update(schema.treasuries)
    .set({ lastBalance: state.balance, lastAllowance: state.allowance, lastDelegate: state.delegate, lastSyncedAt: new Date() })
    .where(eq(schema.treasuries.id, treasury.id));
  return state;
}

export async function getSpendingSnapshot(agentId: string, asset: TreasuryAsset = "usdc") {
  const since = startOfUtcDay();
  const [reservedToday, inFlight] = await Promise.all([
    sumAmounts(db, agentId, asset, RESERVED, since),
    sumAmounts(db, agentId, asset, IN_FLIGHT),
  ]);
  return { reservedToday, inFlight, dayStartsAt: since };
}

export type ProposalInput = PaymentProposal & { campaign?: string };
export type ProposalResult = {
  payment: Payment;
  duplicate: boolean;
};

/**
 * Validates and records payment proposals. Approved ones are reserved against the daily
 * budget; call `executeApproved` afterwards to send them.
 */
export async function proposePayments(args: {
  agentId: string;
  instructionId: string;
  source: "agent" | "creator";
  asset?: TreasuryAsset;
  items: ProposalInput[];
}): Promise<ProposalResult[]> {
  if (args.items.length === 0) return [];
  if (args.items.length > 10) throw new EngineError("At most 10 payments per batch");
  const asset = args.asset ?? "usdc";
  const { agent, treasury } = await loadAgent(args.agentId, asset);
  const policy = toPolicy(agent, treasury);
  const [globalPause, onchain] = await Promise.all([
    isPlatformPaused(),
    readTreasuryState(treasury.address).catch(() => null),
  ]);
  const onchainCtx =
    onchain && onchain.exists && onchain.owner === treasury.ownerWallet && onchain.mint === treasury.mint && !onchain.frozen
      ? { balance: onchain.balance, allowance: onchain.allowance, delegate: onchain.delegate }
      : onchain && !onchain.exists
        ? { balance: 0n, allowance: 0n, delegate: null }
        : null;

  const results: ProposalResult[] = [];
  for (const item of args.items) {
    const idempotencyKey = createHash("sha256")
      .update(`${args.agentId}|${args.instructionId}|${item.recipient}${asset === "usdc" ? "" : `|${asset}`}`)
      .digest("hex");

    const result = await db.transaction(async (tx) => {
      // Serialize budget decisions per agent so concurrent requests can't overspend.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${args.agentId}))`);

      const existing = await tx.query.payments.findFirst({ where: eq(schema.payments.idempotencyKey, idempotencyKey) });
      if (existing) return { payment: existing, duplicate: true };

      const since = startOfUtcDay();
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
      // Sequential: a transaction holds a single connection.
      const reservedToday = await sumAmounts(tx, args.agentId, asset, RESERVED, since);
      const inFlight = await sumAmounts(tx, args.agentId, asset, IN_FLIGHT);
      const contributor = await tx.query.contributors.findFirst({
        where: and(eq(schema.contributors.agentId, args.agentId), eq(schema.contributors.wallet, item.recipient)),
      });
      const recent = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.agentId, args.agentId),
            eq(schema.payments.recipient, item.recipient),
            eq(schema.payments.asset, asset),
            inArray(schema.payments.status, RESERVED),
            gte(schema.payments.createdAt, dayAgo),
          ),
        );

      const decision = evaluatePayment(policy, item, {
        globalPause,
        reservedToday,
        inFlight,
        onchain: onchainCtx,
        contributor: contributor ? { status: contributor.status } : null,
        recentToRecipient: recent[0]?.n ?? 0,
      });

      const status: Payment["status"] =
        decision.decision === "approve" ? "approved" : decision.decision === "needs_approval" ? "awaiting_approval" : "rejected";

      const [payment] = await tx
        .insert(schema.payments)
        .values({
          agentId: args.agentId,
          idempotencyKey,
          instructionId: args.instructionId,
          source: args.source,
          recipient: item.recipient,
          contributorId: contributor?.id ?? null,
          amount: item.amount,
          mint: treasury.mint,
          asset,
          decimals: treasury.decimals,
          symbol: treasury.symbol,
          category: item.category,
          campaign: item.campaign ?? "",
          reason: item.reason,
          status,
          policy: decision,
          reservedAt: status === "approved" ? new Date() : null,
          error: status === "rejected" ? decision.summary : null,
        })
        .returning();
      if (status === "awaiting_approval") {
        await tx.insert(schema.approvals).values({ agentId: args.agentId, paymentId: payment.id });
      }
      return { payment, duplicate: false };
    });

    if (!result.duplicate) {
      const p = result.payment;
      const amt = fmtAmount(p.amount, treasury);
      await logActivity({
        agentId: args.agentId,
        instructionId: args.instructionId,
        type: "payment_policy",
        status: p.status === "approved" ? "checking_permissions" : p.status === "awaiting_approval" ? "awaiting_approval" : "failed",
        message:
          p.status === "approved"
            ? `Policy approved ${amt} to ${p.recipient.slice(0, 4)}…${p.recipient.slice(-4)}`
            : p.status === "awaiting_approval"
              ? `${amt} to ${p.recipient.slice(0, 4)}…${p.recipient.slice(-4)} needs creator approval: ${p.policy.summary}`
              : `Rejected ${amt} to ${p.recipient.slice(0, 4)}…${p.recipient.slice(-4)}: ${p.policy.summary}`,
        data: { paymentId: p.id, amount: p.amount, recipient: p.recipient, decision: p.policy.decision },
      });
    }
    results.push(result);
  }
  return results;
}

/** Executes every `approved` payment of an agent (sequentially). */
export async function executeApproved(agentId: string, paymentIds?: string[]): Promise<Payment[]> {
  const conds = [eq(schema.payments.agentId, agentId), eq(schema.payments.status, "approved")];
  if (paymentIds?.length) conds.push(inArray(schema.payments.id, paymentIds));
  const pending = await db.select().from(schema.payments).where(and(...conds)).orderBy(schema.payments.createdAt);
  const out: Payment[] = [];
  for (const p of pending) out.push(await executePayment(p.id));
  return out;
}

async function fail(paymentId: string, error: string, agentId: string, instructionId: string | null) {
  const [p] = await db
    .update(schema.payments)
    .set({ status: "failed", error })
    .where(eq(schema.payments.id, paymentId))
    .returning();
  await logActivity({ agentId, instructionId, type: "payment_failed", status: "failed", message: `Payment failed: ${error}`, data: { paymentId } });
  return p;
}

/**
 * Executes one approved payment exactly once:
 *  1. atomically claim (approved → executing)
 *  2. re-check kill switches
 *  3. build + sign the fixed transaction, persist signature BEFORE broadcast
 *  4. send, confirm, verify token deltas on-chain
 */
export async function executePayment(paymentId: string): Promise<Payment> {
  const [claimed] = await db
    .update(schema.payments)
    .set({ status: "executing", executedAt: new Date() })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, "approved")))
    .returning();
  if (!claimed) {
    const current = await db.query.payments.findFirst({ where: eq(schema.payments.id, paymentId) });
    if (!current) throw new EngineError("Payment not found", 404);
    return current;
  }
  const { agent, treasury } = await loadAgent(claimed.agentId, claimed.asset);
  const iid = claimed.instructionId;

  if (await isPlatformPaused()) return fail(claimed.id, "Halted: platform payments paused before execution", agent.id, iid);
  if (agent.status !== "active") return fail(claimed.id, "Halted: agent was paused before execution", agent.id, iid);

  await logActivity({
    agentId: agent.id,
    instructionId: iid,
    type: "payment_executing",
    status: "executing",
    message: `Signing & submitting ${fmtAmount(claimed.amount, treasury)} to ${claimed.recipient.slice(0, 4)}…${claimed.recipient.slice(-4)}`,
    data: { paymentId: claimed.id },
  });

  const conn = connection();
  let signature: string;
  let lastValidBlockHeight: number;
  let raw: Buffer;
  try {
    const bh = await conn.getLatestBlockhash("confirmed");
    const blockhash = bh.blockhash;
    lastValidBlockHeight = bh.lastValidBlockHeight;
    const signed = await signAgentPayment({
      paymentId: claimed.id,
      agentId: agent.id,
      agentSignerPubkey: agent.signerPubkey,
      treasury: treasury.address,
      mint: treasury.mint,
      recipient: claimed.recipient,
      amount: claimed.amount,
      recentBlockhash: blockhash,
      tokenProgram: treasury.tokenProgram,
      decimals: treasury.decimals,
    });
    signature = signed.signature;
    raw = signed.tx.serialize();
  } catch (e) {
    return fail(claimed.id, `Could not prepare transaction: ${(e as Error).message}`, agent.id, iid);
  }

  // Persist the signature before broadcasting so a crash can never cause a re-send.
  await db.update(schema.payments).set({ signature, lastValidBlockHeight }).where(eq(schema.payments.id, claimed.id));

  try {
    await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  } catch (e) {
    if (e instanceof SendTransactionError) {
      // Preflight simulation failed: the transaction was not broadcast.
      const logs = e.logs?.slice(-3).join(" | ") ?? "";
      return fail(claimed.id, `Rejected by Solana simulation: ${e.transactionError?.message ?? e.message} ${logs}`.trim(), agent.id, iid);
    }
    // Unknown network outcome: leave as executing; reconcile() will settle it.
    await db.update(schema.payments).set({ error: `Broadcast uncertain: ${(e as Error).message}` }).where(eq(schema.payments.id, claimed.id));
    return reconcilePayment(claimed.id);
  }

  try {
    const res = await confirmByPolling(conn, signature, lastValidBlockHeight, "confirmed");
    if (res.err) {
      return fail(claimed.id, `Transaction failed on-chain: ${JSON.stringify(res.err)}`, agent.id, iid);
    }
  } catch (e) {
    if (!(e instanceof BlockhashExpiredError)) {
      await db.update(schema.payments).set({ error: `Confirmation uncertain: ${(e as Error).message}` }).where(eq(schema.payments.id, claimed.id));
    }
    return reconcilePayment(claimed.id);
  }
  return verifyAndConfirm(claimed.id);
}

/** Fetches the landed transaction and checks that the token movement matches exactly. */
async function verifyAndConfirm(paymentId: string): Promise<Payment> {
  const p = await db.query.payments.findFirst({ where: eq(schema.payments.id, paymentId) });
  if (!p || !p.signature) throw new EngineError("Payment has no signature", 409);
  const { agent, treasury } = await loadAgent(p.agentId, p.asset);
  let txInfo = await getConfirmedTransaction(p.signature);
  for (let i = 0; !txInfo && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    txInfo = await getConfirmedTransaction(p.signature);
  }
  if (!txInfo) {
    await db.update(schema.payments).set({ error: "Confirmed but transaction not yet retrievable; will re-verify" }).where(eq(schema.payments.id, p.id));
    return (await db.query.payments.findFirst({ where: eq(schema.payments.id, p.id) }))!;
  }
  if (txInfo.meta?.err) return fail(p.id, `Transaction failed on-chain: ${JSON.stringify(txInfo.meta.err)}`, agent.id, p.instructionId);

  const recipientDelta = tokenDeltaForOwner(txInfo, p.recipient, p.mint);
  const treasuryDelta = tokenDeltaForAccount(txInfo, treasury.address);
  if (recipientDelta !== p.amount || treasuryDelta !== -p.amount) {
    return fail(
      p.id,
      `Verification mismatch: recipient +${recipientDelta}, treasury ${treasuryDelta}, expected ${p.amount}`,
      agent.id,
      p.instructionId,
    );
  }
  const [confirmed] = await db
    .update(schema.payments)
    .set({ status: "confirmed", confirmedAt: txInfo.blockTime ? new Date(txInfo.blockTime * 1000) : new Date(), error: null })
    .where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, "executing")))
    .returning();
  if (confirmed) {
    await db
      .update(schema.treasuries)
      .set({ totalSpent: sql`${schema.treasuries.totalSpent} + ${p.amount}` })
      .where(eq(schema.treasuries.id, treasury.id));
    await syncTreasury(treasury).catch(() => undefined);
    await logActivity({
      agentId: agent.id,
      instructionId: p.instructionId,
      type: "payment_confirmed",
      status: "completed",
      message: `Confirmed on-chain: ${fmtAmount(p.amount, treasury)} → ${p.recipient.slice(0, 4)}…${p.recipient.slice(-4)}`,
      data: { paymentId: p.id, signature: p.signature },
    });
  }
  return confirmed ?? (await db.query.payments.findFirst({ where: eq(schema.payments.id, p.id) }))!;
}

/** Settles a payment stuck in `executing` by asking the chain what happened. */
export async function reconcilePayment(paymentId: string): Promise<Payment> {
  const p = await db.query.payments.findFirst({ where: eq(schema.payments.id, paymentId) });
  if (!p) throw new EngineError("Payment not found", 404);
  if (p.status !== "executing") return p;
  if (!p.signature) return fail(p.id, "Never signed", p.agentId, p.instructionId);
  const conn = connection();
  const { value } = await conn.getSignatureStatuses([p.signature], { searchTransactionHistory: true });
  const st = value[0];
  if (st) {
    if (st.err) return fail(p.id, `Transaction failed on-chain: ${JSON.stringify(st.err)}`, p.agentId, p.instructionId);
    if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return verifyAndConfirm(p.id);
    return p; // processed but not yet confirmed
  }
  const height = await conn.getBlockHeight("confirmed");
  if (p.lastValidBlockHeight && height > p.lastValidBlockHeight) {
    return fail(p.id, "Transaction expired without landing (no funds moved)", p.agentId, p.instructionId);
  }
  return p;
}

export async function reconcileAgent(agentId: string) {
  const stuck = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.agentId, agentId), eq(schema.payments.status, "executing")));
  for (const p of stuck) await reconcilePayment(p.id).catch(() => undefined);
}

/** Creator approves a pending payment. Policy is re-evaluated (minus the approval gate). */
export async function approvePayment(paymentId: string, approverWallet: string): Promise<Payment> {
  const p = await db.query.payments.findFirst({ where: eq(schema.payments.id, paymentId) });
  if (!p) throw new EngineError("Payment not found", 404);
  const { agent, treasury } = await loadAgent(p.agentId, p.asset);
  if (agent.creatorWallet !== approverWallet) throw new EngineError("Only the agent's creator can approve payments", 403);
  if (p.status !== "awaiting_approval") throw new EngineError(`Payment is ${p.status}, not awaiting approval`, 409);

  const [globalPause, onchain] = await Promise.all([isPlatformPaused(), readTreasuryState(treasury.address).catch(() => null)]);

  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${p.agentId}))`);
    const reservedToday = await sumAmounts(tx, p.agentId, p.asset, RESERVED, startOfUtcDay());
    const inFlight = await sumAmounts(tx, p.agentId, p.asset, IN_FLIGHT);
    const contributor = await tx.query.contributors.findFirst({
      where: and(eq(schema.contributors.agentId, p.agentId), eq(schema.contributors.wallet, p.recipient)),
    });
    const policy = { ...toPolicy(agent, treasury), recipientPolicy: "allowlist_or_approval" as const };
    const decision = evaluatePayment(
      policy,
      { recipient: p.recipient, amount: p.amount, category: p.category, reason: p.reason },
      {
        globalPause,
        reservedToday,
        inFlight,
        onchain: onchain && onchain.exists ? { balance: onchain.balance, allowance: onchain.allowance, delegate: onchain.delegate } : null,
        // Creator approval covers an unlisted recipient, but never a suspended one.
        contributor: contributor?.status === "suspended" ? null : { status: "approved" },
        recentToRecipient: 0,
      },
      { skipApprovalGate: true },
    );
    if (contributor?.status === "suspended") {
      decision.decision = "reject";
      decision.summary = "Recipient contributor is suspended";
    }
    const approved = decision.decision === "approve";
    const [row] = await tx
      .update(schema.payments)
      .set(
        approved
          ? { status: "approved", reservedAt: new Date(), policy: decision }
          : { status: "rejected", policy: decision, error: decision.summary },
      )
      .where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, "awaiting_approval")))
      .returning();
    await tx
      .update(schema.approvals)
      .set({ status: approved ? "approved" : "rejected", approverWallet, decidedAt: new Date() })
      .where(eq(schema.approvals.paymentId, p.id));
    return row;
  });
  if (!updated) throw new EngineError("Payment state changed concurrently", 409);
  await logActivity({
    agentId: p.agentId,
    instructionId: p.instructionId,
    type: "approval",
    status: updated.status === "approved" ? "checking_permissions" : "failed",
    message:
      updated.status === "approved"
        ? `Creator approved ${fmtAmount(p.amount, treasury)} payment`
        : `Approval could not be applied: ${updated.policy.summary}`,
    data: { paymentId: p.id, approver: approverWallet },
  });
  if (updated.status === "approved") return executePayment(updated.id);
  return updated;
}

export async function rejectPayment(paymentId: string, approverWallet: string): Promise<Payment> {
  const p = await db.query.payments.findFirst({ where: eq(schema.payments.id, paymentId) });
  if (!p) throw new EngineError("Payment not found", 404);
  const { agent } = await loadAgent(p.agentId);
  if (agent.creatorWallet !== approverWallet) throw new EngineError("Only the agent's creator can reject payments", 403);
  const [row] = await db
    .update(schema.payments)
    .set({ status: "cancelled", error: "Rejected by creator" })
    .where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, "awaiting_approval")))
    .returning();
  if (!row) throw new EngineError(`Payment is ${p.status}, not awaiting approval`, 409);
  await db
    .update(schema.approvals)
    .set({ status: "rejected", approverWallet, decidedAt: new Date() })
    .where(eq(schema.approvals.paymentId, p.id));
  await logActivity({
    agentId: p.agentId,
    instructionId: p.instructionId,
    type: "approval",
    status: "failed",
    message: `Creator rejected ${fromBaseUnits(p.amount, p.decimals)} ${p.asset === "usdc" ? "USDC" : `$${p.symbol}`} payment`,
    data: { paymentId: p.id },
  });
  return row;
}

/** Verifies a creator/community transaction against the agent's treasuries and records deposits. */
export async function recordTreasuryTransaction(agentId: string, signature: string) {
  const { agent } = await loadAgent(agentId);
  let txInfo = await getConfirmedTransaction(signature);
  for (let i = 0; !txInfo && i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    txInfo = await getConfirmedTransaction(signature);
  }
  if (!txInfo) throw new EngineError("Transaction not found on-chain (yet)", 404);
  if (txInfo.meta?.err) throw new EngineError("Transaction failed on-chain", 400);
  const signer = txInfo.transaction.message.staticAccountKeys[0].toBase58();
  const treasuries = await db.select().from(schema.treasuries).where(eq(schema.treasuries.agentId, agentId));
  let total = 0n;
  for (const treasury of treasuries) {
    const delta = tokenDeltaForAccount(txInfo, treasury.address);
    if (delta > 0n) {
      const inserted = await db
        .insert(schema.treasuryDeposits)
        .values({
          treasuryId: treasury.id,
          signature: treasuries.length > 1 && treasury.asset === "token" ? `${signature}:token` : signature,
          fromWallet: signer,
          amount: delta,
          blockTime: txInfo.blockTime ? new Date(txInfo.blockTime * 1000) : null,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) {
        await db
          .update(schema.treasuries)
          .set({ totalDeposits: sql`${schema.treasuries.totalDeposits} + ${delta}` })
          .where(eq(schema.treasuries.id, treasury.id));
        await logActivity({
          agentId,
          type: "treasury_deposit",
          status: "completed",
          message: `Treasury received ${fmtAmount(delta, treasury)} (verified on-chain)`,
          data: { signature, from: signer },
        });
      }
    } else if (delta < 0n && signer === agent.creatorWallet) {
      await logActivity({
        agentId,
        type: "treasury_withdrawal",
        status: "info",
        message: `Creator withdrew ${fmtAmount(-delta, treasury)} from the treasury`,
        data: { signature },
      });
    }
    total += delta;
    await syncTreasury(treasury).catch(() => undefined);
  }
  return { delta: total };
}
