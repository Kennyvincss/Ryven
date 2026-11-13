import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/server/db";
import { getSpendingSnapshot, loadAgent, recordTreasuryTransaction, syncTreasury, reconcileAgent } from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { fromBaseUnits } from "@/lib/shared/amounts";
import { USDC_DECIMALS } from "@/lib/shared/config";

type P = { params: Promise<{ id: string }> };
const usd = (v: bigint) => fromBaseUnits(v, USDC_DECIMALS);

/** Live treasury state, read from Solana (authoritative) plus engine budget usage. */
export const GET = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const { agent, treasury } = await loadAgent(id);
  await reconcileAgent(id);
  const [state, snap, deposits, pending] = await Promise.all([
    syncTreasury(treasury),
    getSpendingSnapshot(id),
    db.select().from(schema.treasuryDeposits).where(eq(schema.treasuryDeposits.treasuryId, treasury.id)).orderBy(desc(schema.treasuryDeposits.createdAt)).limit(20),
    db.select({ status: schema.payments.status }).from(schema.payments).where(eq(schema.payments.agentId, id)),
  ]);
  const by = (s: string) => pending.filter((p) => p.status === s);
  const remainingDaily = agent.dailyLimit > snap.reservedToday ? agent.dailyLimit - snap.reservedToday : 0n;
  const fresh = await db.query.treasuries.findFirst({ where: eq(schema.treasuries.id, treasury.id) });
  return json({
    address: treasury.address,
    owner: treasury.ownerWallet,
    mint: treasury.mint,
    onchain: {
      exists: state.exists,
      balance: usd(state.balance),
      allowance: state.delegate === agent.signerPubkey ? usd(state.allowance) : "0",
      delegate: state.delegate,
      delegatedToAgent: state.delegate === agent.signerPubkey,
      frozen: state.frozen,
    },
    budget: {
      dailyLimit: usd(agent.dailyLimit),
      usedToday: usd(snap.reservedToday),
      remainingToday: usd(remainingDaily),
      inFlight: usd(snap.inFlight),
      maxPerTx: usd(agent.maxPerTx),
      autoApproveLimit: usd(agent.autoApproveLimit),
    },
    totals: {
      deposits: usd(fresh?.totalDeposits ?? 0n),
      spent: usd(fresh?.totalSpent ?? 0n),
    },
    counts: {
      pending: by("awaiting_approval").length,
      completed: by("confirmed").length,
      failed: by("failed").length,
      rejected: by("rejected").length,
    },
    deposits: deposits.map((d) => ({ signature: d.signature, from: d.fromWallet, amount: usd(d.amount), at: (d.blockTime ?? d.createdAt).toISOString() })),
  });
});

const Body = z.object({ signature: z.string().min(64).max(100) });

/** Called after a creator/community wallet transaction touching the treasury lands. */
export const POST = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  // No session needed: anyone may deposit, and the server only trusts what it reads on-chain.
  enforceRateLimit(req, "treasury", 20, 60_000);
  const { signature } = Body.parse(await req.json());
  const { delta } = await recordTreasuryTransaction(id, signature);
  return json({ ok: true, delta: usd(delta) });
});
