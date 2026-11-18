import { requireSession } from "@/lib/server/auth";
import { approvePayment, EngineError, reconcilePayment, rejectPayment } from "@/lib/server/engine/payments";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { paymentPublicView } from "@/lib/server/queries";

/** Creator approval decisions. Server-side authorization: only the agent's creator. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string; action: string }> }) => {
  const { id, action } = await params;
  const { wallet } = await requireSession();
  enforceRateLimit(req, "approvals", 30, 60_000, wallet);
  let p;
  if (action === "approve") p = await approvePayment(id, wallet);
  else if (action === "reject") p = await rejectPayment(id, wallet);
  else if (action === "reconcile") {
    const existing = await db.query.payments.findFirst({ where: eq(schema.payments.id, id) });
    if (!existing) throw new EngineError("Payment not found", 404);
    p = await reconcilePayment(id);
  } else throw new EngineError("Unknown action", 404);
  return json({ payment: paymentPublicView(p) });
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
