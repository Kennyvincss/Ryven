import { z } from "zod";
import { requireCreator } from "@/lib/server/agents";
import { executePayment, proposePayments } from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { paymentPublicView } from "@/lib/server/queries";
import { toBaseUnits } from "@/lib/shared/amounts";
import { LAUNCH_TOKEN_DECIMALS, PAYMENT_CATEGORY_IDS, USDC_DECIMALS } from "@/lib/shared/config";

const Body = z.object({
  recipient: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  category: z.enum(PAYMENT_CATEGORY_IDS),
  reason: z.string().trim().min(3).max(300),
  /** Client-generated UUID so double-submits can never create two payments. */
  idempotencyKey: z.uuid(),
  asset: z.enum(["usdc", "token"]).default("usdc"),
});

/** Manual payment by the creator. Goes through exactly the same policy engine as the AI. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { session } = await requireCreator(id);
  enforceRateLimit(req, "manual-pay", 20, 60_000, session.wallet);
  const b = Body.parse(await req.json());
  const [r] = await proposePayments({
    agentId: id,
    instructionId: `manual:${b.idempotencyKey}`,
    source: "creator",
    asset: b.asset,
    items: [{ recipient: b.recipient.trim(), amount: toBaseUnits(b.amount, b.asset === "usdc" ? USDC_DECIMALS : LAUNCH_TOKEN_DECIMALS), category: b.category, reason: b.reason, campaign: "Manual payment" }],
  });
  const p = r.payment.status === "approved" ? await executePayment(r.payment.id) : r.payment;
  return json({ payment: paymentPublicView(p), duplicate: r.duplicate });
});
