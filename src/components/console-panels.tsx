"use client";
import { useState } from "react";
import { Activity, CheckCircle2, Clock, Coins, Plus, Send, ShieldAlert, Trash2, Users } from "lucide-react";
import { api } from "@/lib/client/api";
import { PAYMENT_CATEGORIES, usdcLabel } from "@/lib/shared/config";
import { shortAddress } from "@/lib/shared/amounts";
import { PaymentStatus } from "./cards";
import { DEFAULT_POLICY, PolicyForm, policyPayload, type PolicyState } from "./agent-policy-form";
import { AddressLink, Alert, Badge, Button, Card, CardHeader, Empty, Field, Input, Select, Textarea, TxLink, cn, timeAgo } from "./ui";

export type Payment = {
  id: string;
  recipient: string;
  amount: string;
  unit?: string;
  asset?: "usdc" | "token";
  network?: "devnet" | "mainnet";
  category: string;
  campaign: string;
  reason: string;
  status: string;
  source: string;
  signature: string | null;
  explorerUrl: string | null;
  policy: { decision: string; summary: string; checks: { id: string; label: string; passed: boolean; detail: string; effect?: string }[] };
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
};
export type Contributor = { id: string; wallet: string; handle: string; role: string; status: string; activityScore: number; note?: string };
export type TreasuryState = {
  asset: "usdc" | "token" | "sol";
  unit: string;
  symbol: string;
  decimals: number;
  tokenProgram: string;
  enabled: boolean;
  address: string;
  owner: string;
  mint: string;
  onchain: { exists: boolean; balance: string; allowance: string; delegate: string | null; delegatedToAgent: boolean; frozen: boolean };
  budget: { dailyLimit: string; usedToday: string; remainingToday: string; inFlight: string; maxPerTx: string; autoApproveLimit: string };
  totals: { deposits: string; spent: string };
  counts: { pending: number; completed: number; failed: number; rejected: number };
  deposits: { signature: string; from: string; amount: string; at: string }[];
};

export function PolicyChecks({ checks }: { checks: Payment["policy"]["checks"] }) {
  return (
    <ul className="space-y-1">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2 text-xs">
          <span className={cn("mt-0.5 size-1.5 shrink-0 rounded-full", c.passed ? "bg-accent" : c.effect === "approval" ? "bg-warn" : "bg-danger")} />
          <span className="text-muted">
            <span className="text-text">{c.label}:</span> {c.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ApprovalsPanel({ payments, onChange }: { payments: Payment[]; onChange: () => void }) {
  const pending = payments.filter((p) => p.status === "awaiting_approval");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(id: string, action: "approve" | "reject") {
    setBusy(id + action);
    setError(null);
    try {
      await api(`/api/payments/${id}/${action}`, { method: "POST" });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card>
      <CardHeader title="Approval queue" subtitle="Payments the policy engine won't execute without you" icon={<Clock className="size-4" />} right={pending.length ? <Badge tone="warn">{pending.length}</Badge> : null} />
      {pending.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted">Nothing waiting for approval.</div>
      ) : (
        <ul className="divide-y divide-line">
          {pending.map((p) => (
            <li key={p.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-base font-semibold">
                    {p.amount} <span className="text-xs text-muted">{p.unit ?? usdcLabel}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    to <AddressLink address={p.recipient} network={p.network} /> · {timeAgo(p.createdAt)}
                  </div>
                  <div className="mt-1 text-xs text-text/80">“{p.reason}”</div>
                  <div className="mt-1 text-[11px] text-warn">{p.policy.summary}</div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => act(p.id, "approve")} loading={busy === p.id + "approve"}>
                  Approve & send
                </Button>
                <Button size="sm" variant="danger" onClick={() => act(p.id, "reject")} loading={busy === p.id + "reject"}>
                  Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  Details
                </Button>
              </div>
              {open === p.id && (
                <div className="mt-3 rounded-xl border border-line bg-panel-2 p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wider text-faint">
                    Category {p.category} · source {p.source} · id {p.id.slice(0, 8)}
                  </div>
                  <PolicyChecks checks={p.policy.checks} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="px-5 pb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Card>
  );
}

export function PaymentsTable({ payments, onChange }: { payments: Payment[]; onChange?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!payments.length) return <Empty icon={<Coins className="size-5" />} title="No payments yet">Payments the agent makes or proposes appear here.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {payments.map((p) => (
        <li key={p.id} className="px-5 py-3.5">
          <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">
                  {p.amount} {p.unit ?? usdcLabel}
                </span>
                <PaymentStatus status={p.status} />
                {p.source === "creator" && <Badge>manual</Badge>}
              </div>
              <div className="mt-1 truncate text-xs text-muted">
                → {shortAddress(p.recipient, 5)} · {p.reason}
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-faint">
              {timeAgo(p.createdAt)}
              {p.signature && p.status === "confirmed" && (
                <div className="mt-1">
                  <TxLink signature={p.signature} label="Explorer" network={p.network} />
                </div>
              )}
            </div>
          </button>
          {open === p.id && (
            <div className="mt-3 space-y-2 rounded-xl border border-line bg-panel-2 p-3">
              <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                <div>
                  Recipient: <AddressLink address={p.recipient} chars={6} />
                </div>
                <div>Category: {p.category}</div>
                {p.campaign && <div>Campaign: {p.campaign}</div>}
                {p.signature && (
                  <div>
                    Signature: <TxLink signature={p.signature} network={p.network} />
                  </div>
                )}
                {p.confirmedAt && <div>Confirmed: {new Date(p.confirmedAt).toLocaleString()}</div>}
              </div>
              {p.error && <div className="text-xs text-danger">{p.error}</div>}
              <PolicyChecks checks={p.policy.checks} />
              {p.status === "executing" && onChange && (
                <Button size="sm" variant="secondary" onClick={() => api(`/api/payments/${p.id}/reconcile`, { method: "POST" }).then(onChange)}>
                  Re-check on-chain status
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ManualPayment({
  agentId,
  contributors,
  categories,
  onDone,
  tokenSymbol,
  solEnabled,
}: {
  agentId: string;
  contributors: Contributor[];
  categories: string[];
  onDone: () => void;
  /** Set when token rewards are enabled: allows paying in the agent's own token. */
  tokenSymbol?: string | null;
  solEnabled?: boolean;
}) {
  const [f, setF] = useState({ recipient: "", amount: "1", category: categories[0] ?? "community_rewards", reason: "", asset: "usdc" as "usdc" | "token" | "sol" });
  const assets = (["usdc", ...(solEnabled ? ["sol"] : []), ...(tokenSymbol ? ["token"] : [])] as ("usdc" | "token" | "sol")[]);
  const unitOf = (a: "usdc" | "token" | "sol") => (a === "usdc" ? usdcLabel : a === "sol" ? "SOL" : `$${tokenSymbol}`);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ payment: Payment }>(`/api/agents/${agentId}/payments`, { json: { ...f, idempotencyKey: crypto.randomUUID() } });
      setResult(r.payment);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 p-5">
      <p className="text-xs text-muted">Manual payments go through exactly the same policy engine and agent signer as AI-initiated ones.</p>
      <Field label="Recipient">
        <Select value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })}>
          <option value="">Select an approved contributor…</option>
          {contributors.map((c) => (
            <option key={c.id} value={c.wallet}>
              @{c.handle} · {shortAddress(c.wallet)}
            </option>
          ))}
        </Select>
      </Field>
      <Input placeholder="…or paste any wallet address" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value.trim() })} />
      {assets.length > 1 && (
        <div className="flex gap-1 rounded-xl border border-line bg-panel-2 p-1">
          {assets.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setF({ ...f, asset: a })}
              className={cn("flex-1 rounded-lg px-3 py-1.5 text-xs font-medium", f.asset === a ? "bg-panel-3 text-text" : "text-muted")}
            >
              Pay in {unitOf(a)}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${unitOf(f.asset)})`}>
          <Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Category">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {PAYMENT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Reason">
        <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Artwork accepted for the launch banner" />
      </Field>
      <Button onClick={submit} loading={busy} className="w-full" disabled={!f.recipient || !f.reason}>
        <Send className="size-4" /> Submit payment
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <Alert tone={result.status === "confirmed" ? "accent" : result.status === "awaiting_approval" ? "warn" : "danger"} title={result.status.replace("_", " ")}>
          {result.status === "confirmed" && result.signature ? <TxLink signature={result.signature} label="View on Explorer" network={result.network} /> : result.error ?? result.policy.summary}
        </Alert>
      )}
    </div>
  );
}

export function ContributorsPanel({ agentId, contributors, onChange, editable }: { agentId: string; contributors: Contributor[]; onChange: () => void; editable: boolean }) {
  const [f, setF] = useState({ wallet: "", handle: "", role: "community", activityScore: "0", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/agents/${agentId}/contributors`, { json: { ...f, activityScore: Number(f.activityScore) || 0 } });
      setF({ wallet: "", handle: "", role: "community", activityScore: "0", note: "" });
      onChange();
    } catch (e) {
      const issues = (e as { body?: { issues?: { message: string }[] } }).body?.issues;
      setError(issues?.map((i) => i.message).join("; ") || (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {contributors.length === 0 ? (
        <Empty icon={<Users className="size-5" />} title="No approved contributors">
          The agent can only pay wallets on this list autonomously. Add your community contributors.
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {contributors.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">@{c.handle}</span>
                  <Badge>{c.role}</Badge>
                  {c.status !== "approved" && <Badge tone="danger">suspended</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  <AddressLink address={c.wallet} />
                  <span>· activity {c.activityScore}</span>
                </div>
              </div>
              {editable && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => api(`/api/agents/${agentId}/contributors/${c.id}`, { method: "PATCH", json: { status: c.status === "approved" ? "suspended" : "approved" } }).then(onChange)}
                  >
                    {c.status === "approved" ? "Suspend" : "Approve"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => api(`/api/agents/${agentId}/contributors/${c.id}`, { method: "DELETE" }).then(onChange)} aria-label="Remove">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="space-y-3 border-t border-line p-5">
          <div className="text-sm font-semibold">Add approved contributor</div>
          <Input placeholder="Wallet address" value={f.wallet} onChange={(e) => setF({ ...f, wallet: e.target.value.trim() })} />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="handle" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value.replace(/^@/, "") })} />
            <Input placeholder="role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
            <Input placeholder="activity" inputMode="numeric" value={f.activityScore} onChange={(e) => setF({ ...f, activityScore: e.target.value })} />
          </div>
          <Input placeholder="Note (private)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <Button onClick={add} loading={busy} variant="secondary" className="w-full" disabled={!f.wallet || !f.handle}>
            <Plus className="size-4" /> Add contributor
          </Button>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({
  agent,
  instructions,
  onSaved,
}: {
  agent: { id: string; name: string; description: string; personality: string; objectives: string; mode: "autonomous" | "approval"; policy: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string; categories: string[]; recipientPolicy: "allowlist_only" | "allowlist_or_approval" } };
  instructions: string;
  onSaved: () => void;
}) {
  const [p, setP] = useState({ name: agent.name, description: agent.description, personality: agent.personality, objectives: agent.objectives, instructions });
  const [policy, setPolicy] = useState<PolicyState>({ ...DEFAULT_POLICY, mode: agent.mode, ...agent.policy });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/agents/${agent.id}`, { method: "PATCH", json: { ...p, policy: policyPayload(policy) } });
      setMsg({ ok: true, text: "Saved. New limits apply to the next payment." });
      onSaved();
    } catch (e) {
      const issues = (e as { body?: { issues?: { message: string }[] } }).body?.issues;
      setMsg({ ok: false, text: issues?.map((i) => i.message).join("; ") || (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 p-5">
      <Alert tone="info">
        <ShieldAlert className="mr-1 inline size-3.5" /> Only you (the creator wallet) can change these. The AI agent has no tool to modify its own limits.
      </Alert>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Input value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
        </Field>
      </div>
      <Field label="Personality">
        <Input value={p.personality} onChange={(e) => setP({ ...p, personality: e.target.value })} />
      </Field>
      <Field label="Objectives">
        <Textarea value={p.objectives} onChange={(e) => setP({ ...p, objectives: e.target.value })} />
      </Field>
      <Field label="Standing instructions">
        <Textarea value={p.instructions} onChange={(e) => setP({ ...p, instructions: e.target.value })} />
      </Field>
      <PolicyForm value={policy} onChange={setPolicy} />
      <Button onClick={save} loading={busy} className="w-full">
        Save changes
      </Button>
      {msg && <Alert tone={msg.ok ? "accent" : "danger"}>{msg.text}</Alert>}
    </div>
  );
}

export type ActivityItem = { id: string; type: string; status: string; message: string; createdAt: string; data: Record<string, unknown> | null };

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const tone = (s: string) =>
    s === "completed" ? "text-accent" : s === "failed" ? "text-danger" : s === "awaiting_approval" ? "text-warn" : s === "executing" ? "text-info" : "text-muted";
  if (!items.length) return <Empty icon={<Activity className="size-5" />} title="No activity yet" />;
  return (
    <ul className="scrollbar-thin max-h-[420px] space-y-0 overflow-y-auto px-5 py-3">
      {items.map((a) => (
        <li key={a.id} className="relative border-l border-line py-2 pl-4">
          <span className={cn("absolute -left-[5px] top-3.5 size-2.5 rounded-full border-2 border-panel bg-current", tone(a.status))} />
          <div className="flex items-start justify-between gap-2">
            <div className="text-[13px] leading-snug">{a.message}</div>
            <div className="shrink-0 text-[11px] text-faint">{timeAgo(a.createdAt)}</div>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
            <span className={tone(a.status)}>{a.status.replace(/_/g, " ")}</span>
            {typeof a.data?.signature === "string" && <TxLink signature={a.data.signature} network={a.data.network === "mainnet" || a.data.network === "devnet" ? a.data.network : undefined} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BudgetBar({ used, limit }: { used: string; limit: string }) {
  const pct = Math.min(100, (Number(used) / Math.max(Number(limit), 1e-9)) * 100);
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>Daily budget used</span>
        <span className="font-mono">
          {used} / {limit}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel-3">
        <div className={cn("h-full rounded-full", pct > 90 ? "bg-danger" : pct > 60 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CheckIcon() {
  return <CheckCircle2 className="size-4 text-accent" />;
}
