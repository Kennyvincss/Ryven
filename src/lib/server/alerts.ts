import "server-only";
/**
 * Price alerts: the agent sets them for its creator; a checker (every minute while the server
 * runs, or GET /api/cron/alerts) reads live prices and fires each alert once. Read-only:
 * an alert notifies, it never trades.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db, schema } from "./db";
import { jupTokens } from "./portfolio";
import { getMarketData } from "./market";
import { resolveMint, symbolOf } from "./jupiter";
import { logActivity } from "./engine/activity";
import { EngineError } from "./engine/payments";
import { AlertInputError, describeAlert, fmtUsd, isTriggered, resolveAlert, type AlertCondition, type AlertMetric } from "./alert-rules";

export type PriceAlert = typeof schema.priceAlerts.$inferSelect;
export const MAX_ACTIVE_ALERTS = 20;

type Quote = { symbol: string; price: number | null; marketCap: number | null };

/** Live USD price + market cap for many mints (Jupiter batch, pump.fun curve / DexScreener fallback). */
export async function quotes(mints: string[]): Promise<Map<string, Quote>> {
  const info = await jupTokens(mints);
  const out = new Map<string, Quote>();
  await Promise.all(
    mints.map(async (m) => {
      const t = info.get(m);
      if (t?.usdPrice != null) {
        out.set(m, { symbol: t.symbol ?? symbolOf(m), price: t.usdPrice, marketCap: t.mcap ?? null });
        return;
      }
      const md = await getMarketData(m).catch(() => null);
      out.set(m, { symbol: t?.symbol ?? symbolOf(m), price: md?.priceUsd ?? null, marketCap: md?.marketCapUsd ?? null });
    }),
  );
  return out;
}

const valueOf = (q: Quote | undefined, metric: string) => (q ? (metric === "market_cap" ? q.marketCap : q.price) : null);

export async function createAlert(args: { agentId: string; token: string; metric: AlertMetric; condition: AlertCondition; value: number; note?: string | null }) {
  let mint: string;
  try {
    mint = resolveMint(args.token);
    new PublicKey(mint);
  } catch (e) {
    throw new EngineError((e as Error).message, 400);
  }
  const active = await db.select({ id: schema.priceAlerts.id }).from(schema.priceAlerts).where(and(eq(schema.priceAlerts.agentId, args.agentId), eq(schema.priceAlerts.status, "active")));
  if (active.length >= MAX_ACTIVE_ALERTS) throw new EngineError(`You already have ${MAX_ACTIVE_ALERTS} active alerts. Cancel one first.`, 400);

  const q = (await quotes([mint])).get(mint);
  const current = valueOf(q, args.metric);
  if (current === null && args.metric === "market_cap") throw new EngineError("No market cap is available for this token. Try a price alert instead.", 400);
  let resolved;
  try {
    resolved = resolveAlert(args.condition, args.value, current);
  } catch (e) {
    if (e instanceof AlertInputError) throw new EngineError(e.message, 400);
    throw e;
  }
  const condition = args.condition === "rises_pct" ? `rises ${args.value}%` : args.condition === "falls_pct" ? `falls ${args.value}%` : `${args.condition} ${fmtUsd(args.value)}`;
  const [alert] = await db
    .insert(schema.priceAlerts)
    .values({
      agentId: args.agentId,
      mint,
      symbol: q?.symbol ?? symbolOf(mint),
      metric: args.metric,
      direction: resolved.direction,
      target: resolved.target,
      baseValue: current,
      condition,
      note: args.note?.slice(0, 200) || null,
      lastValue: current,
      lastCheckedAt: new Date(),
    })
    .returning();
  await logActivity({ agentId: args.agentId, type: "price_alert_set", status: "info", isPublic: false, message: `Price alert set: ${describeAlert(alert)}${current !== null ? ` (now ${fmtUsd(current)})` : ""}`, data: { alertId: alert.id } });
  return alert;
}

export async function listAlerts(agentId: string, opts: { activeOnly?: boolean; limit?: number } = {}) {
  return db
    .select()
    .from(schema.priceAlerts)
    .where(opts.activeOnly ? and(eq(schema.priceAlerts.agentId, agentId), eq(schema.priceAlerts.status, "active")) : eq(schema.priceAlerts.agentId, agentId))
    .orderBy(desc(schema.priceAlerts.createdAt))
    .limit(opts.limit ?? 50);
}

export async function cancelAlert(agentId: string, alertId: string) {
  const [a] = await db
    .update(schema.priceAlerts)
    .set({ status: "cancelled" })
    .where(and(eq(schema.priceAlerts.id, alertId), eq(schema.priceAlerts.agentId, agentId), eq(schema.priceAlerts.status, "active")))
    .returning();
  if (!a) throw new EngineError("No active alert with that id", 404);
  await logActivity({ agentId, type: "price_alert_cancelled", status: "info", isPublic: false, message: `Price alert cancelled: ${describeAlert(a)}` });
  return a;
}

/** Checks every active alert once; each alert fires at most once (atomic status change). */
export async function checkAlerts(max = 500) {
  const active = await db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.status, "active")).orderBy(asc(schema.priceAlerts.lastCheckedAt)).limit(max);
  if (!active.length) return { checked: 0, triggered: 0 };
  const q = await quotes([...new Set(active.map((a) => a.mint))]);
  const now = new Date();
  let triggered = 0;
  const fired: string[] = [];
  for (const a of active) {
    const v = valueOf(q.get(a.mint), a.metric);
    if (!isTriggered(a.direction as "above" | "below", a.target, v)) continue;
    const [hit] = await db
      .update(schema.priceAlerts)
      .set({ status: "triggered", triggeredAt: now, triggeredValue: v, lastValue: v, lastCheckedAt: now })
      .where(and(eq(schema.priceAlerts.id, a.id), eq(schema.priceAlerts.status, "active")))
      .returning();
    if (!hit) continue;
    triggered++;
    fired.push(a.id);
    await logActivity({
      agentId: a.agentId,
      type: "price_alert_triggered",
      status: "completed",
      isPublic: false,
      message: `🔔 Price alert: ${describeAlert(a)} hit, now ${fmtUsd(v!)}${a.note ? `. Note: ${a.note}` : ""}`,
      data: { alertId: a.id, mint: a.mint, value: v },
    });
  }
  // Record the latest value for the rest (cheap: one statement per distinct mint+metric).
  const rest = active.filter((a) => !fired.includes(a.id));
  const groups = new Map<string, string[]>();
  for (const a of rest) {
    const k = `${a.mint}|${a.metric}`;
    groups.set(k, [...(groups.get(k) ?? []), a.id]);
  }
  for (const [k, ids] of groups) {
    const [mint, metric] = k.split("|");
    await db.update(schema.priceAlerts).set({ lastValue: valueOf(q.get(mint), metric), lastCheckedAt: now }).where(inArray(schema.priceAlerts.id, ids));
  }
  return { checked: active.length, triggered };
}

export const alertView = (a: PriceAlert) => ({
  id: a.id,
  mint: a.mint,
  symbol: a.symbol,
  metric: a.metric,
  direction: a.direction,
  target: a.target,
  condition: a.condition,
  description: describeAlert(a),
  note: a.note,
  status: a.status,
  baseValue: a.baseValue,
  lastValue: a.lastValue,
  lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null,
  triggeredValue: a.triggeredValue,
  triggeredAt: a.triggeredAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});
