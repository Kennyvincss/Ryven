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

export async function logActivity(a: {
  agentId: string;
  type: string;
  status: ActivityStatus;
  message: string;
  data?: Record<string, unknown>;
  instructionId?: string | null;
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
      isPublic: a.isPublic ?? true,
    })
    .returning();
  return row;
}
