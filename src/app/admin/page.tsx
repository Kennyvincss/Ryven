"use client";
import { useState } from "react";
import { OctagonX, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/session";
import { usdcLabel } from "@/lib/shared/config";
import { PaymentsTable, type Payment } from "@/components/console-panels";
import { AuthGate } from "@/components/wallet-button";
import { AddressLink, Alert, Badge, Button, Card, CardHeader, PageHeader, Spinner, Stat } from "@/components/ui";

type Resp = {
  stats: { users: number; tokensLaunched: number; agentsDeployed: number; activeAgents: number; confirmedPayments: number; paymentVolume: string; failedPayments: number; totalDeposits: string; usdcManaged: string };
  paymentsPaused: boolean;
  agents: { id: string; name: string; status: string; creatorWallet: string; stats: { confirmedPayments: number; confirmedVolume: string; pendingApprovals?: number } | null; token: { symbol: string } }[];
  failedPayments: Payment[];
};

function Inner() {
  const q = useApi<Resp>("/api/admin", { refreshMs: 15000 });
  const [busy, setBusy] = useState<string | null>(null);
  if (q.loading) return <Spinner />;
  if (q.error) return <Alert tone="danger">{q.error}</Alert>;
  const d = q.data!;
  const s = d.stats;
  return (
    <div className="space-y-6">
      <Card className={d.paymentsPaused ? "border-danger/40 p-5" : "p-5"}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <OctagonX className="size-4 text-danger" /> Emergency payment kill switch
            </div>
            <p className="mt-1 text-sm text-muted">Halts execution of every agent payment on the platform immediately. Creators cannot override it.</p>
          </div>
          <Button
            variant={d.paymentsPaused ? "primary" : "danger"}
            loading={busy === "global"}
            onClick={async () => {
              setBusy("global");
              await api("/api/admin", { json: { paymentsPaused: !d.paymentsPaused } }).finally(() => setBusy(null));
              q.reload();
            }}
          >
            {d.paymentsPaused ? "Resume all payments" : "Pause all payments"}
          </Button>
        </div>
        {d.paymentsPaused && <div className="mt-3"><Badge tone="danger" dot>All agent payments are paused</Badge></div>}
      </Card>
      <Card className="grid grid-cols-2 gap-5 p-5 md:grid-cols-4 lg:grid-cols-8">
        <Stat label="Users" value={s.users} />
        <Stat label="Tokens" value={s.tokensLaunched} />
        <Stat label="Agents" value={s.agentsDeployed} />
        <Stat label="Active agents" value={s.activeAgents} />
        <Stat label="Deposits" value={s.totalDeposits} hint={usdcLabel} />
        <Stat label="Payments" value={s.confirmedPayments} />
        <Stat label="Paid volume" value={s.paymentVolume} hint={usdcLabel} />
        <Stat label="Failed tx" value={s.failedPayments} />
      </Card>
      <Card>
        <CardHeader title="Agents" />
        <ul className="divide-y divide-line">
          {d.agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{a.name} <span className="text-muted">${a.token.symbol}</span></div>
                <div className="text-xs text-muted">creator <AddressLink address={a.creatorWallet} /> · {a.stats?.confirmedPayments ?? 0} payments · {a.stats?.confirmedVolume ?? 0} {usdcLabel}</div>
              </div>
              <div className="flex items-center gap-2">
                {a.status === "active" ? <Badge tone="accent">active</Badge> : <Badge tone="warn">paused</Badge>}
                {a.status === "active" && (
                  <Button size="sm" variant="danger" loading={busy === a.id} onClick={async () => {
                    setBusy(a.id);
                    await api(`/api/agents/${a.id}/status`, { json: { action: "pause", reason: "Paused by administrator" } }).finally(() => setBusy(null));
                    q.reload();
                  }}>Pause</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Failed transactions" subtitle="Latest 25" />
        <PaymentsTable payments={d.failedPayments} />
      </Card>
    </div>
  );
}

export default function Admin() {
  const { session } = useSession();
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow={<span className="flex items-center gap-1"><ShieldCheck className="size-3.5" /> Administration</span>} title="Platform monitor" subtitle="Restricted to platform administrators." />
      <AuthGate title="Administrator sign-in">{session?.isAdmin ? <Inner /> : <Alert tone="danger">This wallet is not an administrator.</Alert>}</AuthGate>
    </div>
  );
}
