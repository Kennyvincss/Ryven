import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/server/db";
import {
  assetLabel,
  getSpendingSnapshot,
  loadAgent,
  recordTreasuryTransaction,
  syncTreasury,
  reconcileAgent,
  toPolicy,
} from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { fromBaseUnits } from "@/lib/shared/amounts";

type P = { params: Promise<{ id: string }> };

/**
 * Live treasury state, read from Solana (authoritative) plus engine budget usage.
 * `?asset=usdc` (default) or `?asset=token` for the agent's own-token rewards treasury.
 */
export const GET = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  const q = new URL(req.url).searchParams.get("asset");
  const asset = q === "token" ? "token" : q === "sol" ? "sol" : "usdc";
  const { agent, treasury } = await loadAgent(id, asset);
  await reconcileAgent(id);
  const policy = toPolicy(agent, treasury);
  const fmt = (v: bigint) => fromBaseUnits(v, treasury.decimals);
  const [state, snap, deposits, pending] = await Promise.all([
    syncTreasury(treasury, agent.network),
    getSpendingSnapshot(id, asset),
    db.select().from(schema.treasuryDeposits).where(eq(schema.treasuryDeposits.treasuryId, treasury.id)).orderBy(desc(schema.treasuryDeposits.createdAt)).limit(20),
    db
      .select({ status: schema.payments.status })
      .from(schema.payments)
      .where(and(eq(schema.payments.agentId, id), eq(schema.payments.asset, asset))),
  ]);
  const by = (s: string) => pending.filter((p) => p.status === s);
  const remainingDaily = policy.dailyLimit > snap.reservedToday ? policy.dailyLimit - snap.reservedToday : 0n;
  const fresh = await db.query.treasuries.findFirst({ where: eq(schema.treasuries.id, treasury.id) });
  return json({
    asset,
    network: agent.network,
    unit: assetLabel(treasury),
    symbol: treasury.symbol,
    decimals: treasury.decimals,
    tokenProgram: treasury.tokenProgram,
    enabled: policy.dailyLimit > 0n,
    address: treasury.address,
    owner: treasury.ownerWallet,
    mint: treasury.mint,
    onchain: {
      exists: state.exists,
      balance: fmt(state.balance),
      allowance: state.delegate === agent.signerPubkey ? fmt(state.allowance) : "0",
      delegate: state.delegate,
      delegatedToAgent: state.delegate === agent.signerPubkey,
      frozen: state.frozen,
    },
    budget: {
      dailyLimit: fmt(policy.dailyLimit),
      usedToday: fmt(snap.reservedToday),
      remainingToday: fmt(remainingDaily),
      inFlight: fmt(snap.inFlight),
      maxPerTx: fmt(policy.maxPerTx),
      autoApproveLimit: fmt(policy.autoApproveLimit),
    },
    totals: {
      deposits: fmt(fresh?.totalDeposits ?? 0n),
      spent: fmt(fresh?.totalSpent ?? 0n),
    },
    counts: {
      pending: by("awaiting_approval").length,
      completed: by("confirmed").length,
      failed: by("failed").length,
      rejected: by("rejected").length,
    },
    deposits: deposits.map((d) => ({ signature: d.signature.replace(/:token$/, ""), from: d.fromWallet, amount: fmt(d.amount), at: (d.blockTime ?? d.createdAt).toISOString() })),
  });
});

const Body = z.object({ signature: z.string().min(64).max(100) });

/** Called after a creator/community wallet transaction touching a treasury lands. */
export const POST = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  // No session needed: anyone may deposit, and the server only trusts what it reads on-chain.
  enforceRateLimit(req, "treasury", 20, 60_000);
  const { signature } = Body.parse(await req.json());
  await recordTreasuryTransaction(id, signature);
  return json({ ok: true });
});
