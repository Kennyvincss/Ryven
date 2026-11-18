"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { Alert, Badge, Button, Empty, Spinner, timeAgo } from "./ui";

export type AlertView = {
  id: string;
  mint: string;
  symbol: string;
  metric: "price" | "market_cap";
  direction: "above" | "below";
  target: number;
  condition: string;
  description: string;
  note: string | null;
  status: "active" | "triggered" | "cancelled";
  baseValue: number | null;
  lastValue: number | null;
  lastCheckedAt: string | null;
  triggeredValue: number | null;
  triggeredAt: string | null;
  createdAt: string;
};

function usd(n: number | null) {
  if (n === null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${Number(n.toPrecision(3))}`;
}

/** How far the current value is from the target, e.g. "12.4% to go". */
function distance(a: AlertView) {
  if (a.lastValue === null || a.lastValue === 0) return null;
  const pct = ((a.target - a.lastValue) / a.lastValue) * 100;
  return `${Math.abs(pct).toFixed(1)}% ${pct > 0 ? "rise" : "drop"} to go`;
}

const SEEN_KEY = (agentId: string) => `ryven:alerts-seen:${agentId}`;
function readSeen(agentId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY(agentId)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSeen(agentId: string, ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY(agentId), JSON.stringify([...ids].slice(-200)));
  } catch {
    // storage unavailable: banners may repeat after a reload, nothing else breaks
  }
}

/**
 * Runs while the console is open: polls alerts and, when one fires, shows a banner and (if
 * allowed) a browser notification. Alerts that fired while the console was closed show once.
 */
export function AlertWatcher({ agentId }: { agentId: string }) {
  const q = useApi<{ alerts: AlertView[] }>(`/api/agents/${agentId}/alerts`, { refreshMs: 30_000 });
  const [fresh, setFresh] = useState<AlertView[]>([]);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!q.data) return;
    seen.current ??= readSeen(agentId);
    const dayAgo = Date.now() - 24 * 3600_000;
    const newly = q.data.alerts.filter((a) => a.status === "triggered" && !seen.current!.has(a.id) && a.triggeredAt && Date.parse(a.triggeredAt) > dayAgo);
    if (!newly.length) return;
    for (const a of newly) seen.current.add(a.id);
    writeSeen(agentId, seen.current);
    setFresh((f) => [...newly, ...f].slice(0, 5));
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const a of newly) new Notification(`🔔 ${a.symbol} alert`, { body: `${a.description}: now ${usd(a.triggeredValue)}${a.note ? `. ${a.note}` : ""}` });
      }
    } catch {
      // notifications unsupported here
    }
  }, [q.data, agentId]);

  if (!fresh.length) return null;
  return (
    <div className="space-y-2">
      {fresh.map((a) => (
        <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <BellRing className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <span className="font-semibold">{a.description}</span>: now <span className="font-mono">{usd(a.triggeredValue)}</span>
              {a.note && <div className="text-xs text-muted">{a.note}</div>}
              {a.triggeredAt && <div className="text-xs text-muted">{timeAgo(a.triggeredAt)}</div>}
            </div>
          </div>
          <button type="button" aria-label="Dismiss" className="text-muted hover:text-text" onClick={() => setFresh((f) => f.filter((x) => x.id !== a.id))}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PriceAlertsPanel({ agentId }: { agentId: string }) {
  const q = useApi<{ alerts: AlertView[] }>(`/api/agents/${agentId}/alerts`, { refreshMs: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [perm, setPerm] = useState<string>("unsupported");
  useEffect(() => {
    // read after mount (not during SSR) to avoid a hydration mismatch
    const p = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    queueMicrotask(() => setPerm(p));
  }, []);

  if (q.loading && !q.data) return <Spinner className="m-6" />;
  if (q.error) return <div className="p-5"><Alert tone="danger">{q.error}</Alert></div>;
  const alerts = q.data!.alerts;
  const active = alerts.filter((a) => a.status === "active");
  const past = alerts.filter((a) => a.status !== "active");

  async function cancel(id: string) {
    setBusy(id);
    setErr(null);
    try {
      await api(`/api/agents/${agentId}/alerts/${id}`, { method: "DELETE" });
      q.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function enableNotifications() {
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      setPerm("unsupported");
    }
  }

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="size-4 text-agent" /> Price alerts
          </div>
          <p className="mt-1 max-w-prose text-xs text-muted">
            Ask the agent, e.g. “alert me if SOL drops below $150”, “tell me when our market cap hits $1M” or “alert me if &lt;coin&gt; falls 20%”.
            Checked every minute while your Ryven server runs. Alerts only notify; they never trade.
          </p>
        </div>
        {perm === "default" && (
          <Button size="sm" variant="secondary" onClick={enableNotifications}>
            Enable browser notifications
          </Button>
        )}
        {perm === "granted" && <Badge tone="accent" dot>Browser notifications on</Badge>}
        {perm === "denied" && <span className="text-xs text-muted">Browser notifications are blocked for this site.</span>}
      </div>

      {err && <Alert tone="danger">{err}</Alert>}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Active ({active.length}/20)</div>
        {active.length === 0 ? (
          <Empty icon={<Bell className="size-5" />} title="No active alerts">
            Ask the agent in the terminal to set one.
          </Empty>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {active.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{a.description}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>now {usd(a.lastValue)}</span>
                    {distance(a) && <span>{distance(a)}</span>}
                    {a.lastCheckedAt && <span>checked {timeAgo(a.lastCheckedAt)}</span>}
                    {a.note && <span>“{a.note}”</span>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" loading={busy === a.id} onClick={() => cancel(a.id)}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">History</div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {past.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <span>{a.description}</span>
                  {a.status === "triggered" && <span className="text-muted"> · hit at {usd(a.triggeredValue)}</span>}
                </div>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Badge tone={a.status === "triggered" ? "warn" : "neutral"}>{a.status}</Badge>
                  {timeAgo(a.triggeredAt ?? a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
