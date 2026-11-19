"use client";
import { useState } from "react";
import { Lightbulb, RefreshCw } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { Alert, Badge, Button, Empty, Field, Select, Spinner, cn, timeAgo } from "./ui";

type Brief = {
  id: string;
  source: "scheduled" | "manual";
  content: string;
  totalUsd: number | null;
  data: { flags?: string[]; allocation?: { sol: number; stable: number; other: number } };
  createdAt: string;
};
type BriefResp = { settings: { enabled: boolean; hourUtc: number; lastAt: string | null }; briefs: Brief[] };

const usd = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 }));

/** "08:00 UTC (09:00 your time)". */
function hourLabel(h: number) {
  const d = new Date(Date.UTC(2026, 0, 1, h));
  const local = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${String(h).padStart(2, "0")}:00 UTC (${local} your time)`;
}

export function WalletBriefPanel({ agentId }: { agentId: string }) {
  const q = useApi<BriefResp>(`/api/agents/${agentId}/briefs`);
  const [busy, setBusy] = useState<"gen" | "save" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ enabled: boolean; hourUtc: number } | null>(null);

  if (q.loading && !q.data) return <Spinner className="m-6" />;
  if (q.error) return <div className="p-5"><Alert tone="danger">{q.error}</Alert></div>;
  const d = q.data!;
  const f = form ?? { enabled: d.settings.enabled, hourUtc: d.settings.hourUtc };
  const dirty = f.enabled !== d.settings.enabled || f.hourUtc !== d.settings.hourUtc;
  const [latest, ...older] = d.briefs;

  async function generate() {
    setBusy("gen");
    setMsg(null);
    try {
      await api(`/api/agents/${agentId}/briefs`, { method: "POST" });
      q.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      await api(`/api/agents/${agentId}`, { method: "PATCH", json: { brief: f } });
      setMsg({ ok: true, text: f.enabled ? `Daily brief on: every day at ${hourLabel(f.hourUtc)}.` : "Daily brief turned off." });
      setForm(null);
      q.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="size-4 text-agent" /> Wallet brief
          </div>
          <p className="mt-1 max-w-prose text-xs text-muted">
            Your agent analyses your wallet (value, allocation, risks, recent moves) and suggests ideas. Ideas only: it never trades or pays from a
            brief. You can also ask anytime in the terminal, e.g. “analyse my wallet and give me ideas”.
          </p>
        </div>
        <Button size="sm" onClick={generate} loading={busy === "gen"}>
          <RefreshCw className="size-3.5" /> Generate now
        </Button>
      </div>

      {msg && <Alert tone={msg.ok ? "accent" : "danger"}>{msg.text}</Alert>}

      {latest ? (
        <div className="rounded-xl border border-agent/30 bg-agent/5 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span className="flex items-center gap-2">
              <span className="font-mono text-base font-semibold text-text">{usd(latest.totalUsd)}</span>
              {latest.data.allocation && (
                <span>
                  SOL {latest.data.allocation.sol}% · stables {latest.data.allocation.stable}% · other {latest.data.allocation.other}%
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <Badge>{latest.source}</Badge> {timeAgo(latest.createdAt)}
            </span>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{latest.content}</div>
        </div>
      ) : (
        <Empty icon={<Lightbulb className="size-5" />} title="No brief yet">
          Click <b>Generate now</b> for your first wallet brief.
        </Empty>
      )}

      <div className="rounded-xl border border-line p-4">
        <div className="text-sm font-semibold">Daily brief</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <div className="flex gap-2">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                onClick={() => setForm({ ...f, enabled: on })}
                className={cn("rounded-lg border px-3 py-2 text-sm", f.enabled === on ? "border-agent/60 bg-agent/10" : "border-line-2 bg-panel-2 hover:bg-panel-3")}
              >
                {on ? "On" : "Off"}
              </button>
            ))}
          </div>
          <Field label="Time">
            <Select value={f.hourUtc} disabled={!f.enabled} onChange={(e) => setForm({ ...f, hourUtc: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">{d.settings.lastAt ? `Last brief ${timeAgo(d.settings.lastAt)}` : "Runs while your Ryyven server is running."}</span>
          <Button size="sm" variant="secondary" onClick={save} loading={busy === "save"} disabled={!dirty}>
            Save
          </Button>
        </div>
      </div>

      {older.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Earlier briefs</div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {older.map((b) => (
              <li key={b.id} className="px-4 py-3 text-sm">
                <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <span className="font-mono">{usd(b.totalUsd)}</span>
                  <span className="text-xs text-muted">
                    {b.source} · {timeAgo(b.createdAt)}
                  </span>
                </button>
                {open === b.id && <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{b.content}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
