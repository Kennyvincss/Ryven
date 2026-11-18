import "server-only";
import { db, schema } from "../db";

export type ActivityStatus =
  | "thinking"
  | "analysing"
  | "checking_permissions"
  | "preparing_payment"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "info";

/**
 * Activity types anyone may see on the agent's public page: the on-chain facts that make the
 * agent accountable. Everything else (instructions, policy decisions, rejected or failed
 * payments, approvals, trading, settings, contributors, alerts, briefs) is creator-only.
 */
export const PUBLIC_ACTIVITY_TYPES = new Set(["deployed", "payment_confirmed", "treasury_deposit", "agent_paused", "agent_resumed"]);

/** Fields of `data` that may be shown publicly (on-chain references only). */
const PUBLIC_DATA_KEYS = ["signature", "network"];

export async function logActivity(a: {
  agentId: string;
  type: string;
  status: ActivityStatus;
  message: string;
  data?: Record<string, unknown>;
  instructionId?: string | null;
  /** Only honoured to make an activity private; public visibility is decided by type. */
  isPublic?: boolean;
}) {
  const [row] = await db
    .insert(schema.agentActivities)
    .values({
      agentId: a.agentId,
      type: a.type,
      status: a.status,
      message: a.message,
      data: a.data ? (JSON.parse(JSON.stringify(a.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Record<string, unknown>) : null,
      instructionId: a.instructionId ?? null,
      isPublic: a.isPublic !== false && PUBLIC_ACTIVITY_TYPES.has(a.type),
    })
    .returning();
  return row;
}

type ActivityRow = typeof schema.agentActivities.$inferSelect;

/** What a visitor (not the creator) sees of an activity. */
export function activityPublicView(a: ActivityRow) {
  const data = a.data ? Object.fromEntries(PUBLIC_DATA_KEYS.filter((k) => k in a.data!).map((k) => [k, a.data![k]])) : null;
  return { id: a.id, agentId: a.agentId, type: a.type, status: a.status, message: a.message, data, createdAt: a.createdAt.toISOString() };
}
